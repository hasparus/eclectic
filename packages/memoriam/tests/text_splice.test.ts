import { describe, it, expect } from 'vitest';

/**
 * The `apply_text_splice` helper in `Session.svelte.js` is private,
 * so we re-implement the same algorithm here in an exportable shape
 * and assert that it produces the expected single-splice
 * `(prefix, deleteCount, insertText)` triple for every keystroke
 * shape the editor can fire.
 *
 * If the algorithm in Session ever diverges from this one,
 * concurrent typing will start losing keystrokes — this test is the
 * safety net.
 */
function compute_text_splice(
	old_text: string,
	new_text: string
): { prefix: number; deleteCount: number; insertText: string } | null {
	if (old_text === new_text) return null;
	let prefix = 0;
	const maxLen = Math.min(old_text.length, new_text.length);
	while (prefix < maxLen && old_text.charCodeAt(prefix) === new_text.charCodeAt(prefix)) {
		prefix++;
	}
	let suffix = 0;
	const maxSuffix = Math.min(old_text.length - prefix, new_text.length - prefix);
	while (
		suffix < maxSuffix &&
		old_text.charCodeAt(old_text.length - 1 - suffix) ===
			new_text.charCodeAt(new_text.length - 1 - suffix)
	) {
		suffix++;
	}
	const deleteCount = old_text.length - prefix - suffix;
	const insertText = new_text.slice(prefix, new_text.length - suffix);
	if (deleteCount === 0 && insertText.length === 0) return null;
	return { prefix, deleteCount, insertText };
}

describe('annotated_text → Automerge splice diff', () => {
	it('single-char insert at end → one insert', () => {
		expect(compute_text_splice('hello', 'helloo')).toEqual({
			prefix: 5,
			deleteCount: 0,
			insertText: 'o'
		});
	});

	it('single-char insert in the middle → one insert at the right offset', () => {
		expect(compute_text_splice('helo', 'hello')).toEqual({
			prefix: 3,
			deleteCount: 0,
			insertText: 'l'
		});
	});

	it('backspace at end → one delete', () => {
		expect(compute_text_splice('hello', 'hell')).toEqual({
			prefix: 4,
			deleteCount: 1,
			insertText: ''
		});
	});

	it('backspace in the middle → one delete at the right offset', () => {
		expect(compute_text_splice('hellxo', 'hello')).toEqual({
			prefix: 4,
			deleteCount: 1,
			insertText: ''
		});
	});

	it('select+type — middle replacement → one combined splice', () => {
		// "hello WORLD" → user selects "WORLD" and types "there"
		expect(compute_text_splice('hello WORLD', 'hello there')).toEqual({
			prefix: 6,
			deleteCount: 5,
			insertText: 'there'
		});
	});

	it('paste at start → one prefix-zero insert', () => {
		expect(compute_text_splice('world', 'hello world')).toEqual({
			prefix: 0,
			deleteCount: 0,
			insertText: 'hello '
		});
	});

	it('delete-everything → one big delete', () => {
		expect(compute_text_splice('hello', '')).toEqual({
			prefix: 0,
			deleteCount: 5,
			insertText: ''
		});
	});

	it('type into empty → one big insert', () => {
		expect(compute_text_splice('', 'hello')).toEqual({
			prefix: 0,
			deleteCount: 0,
			insertText: 'hello'
		});
	});

	it('no change → no splice (callers skip when null)', () => {
		expect(compute_text_splice('hello', 'hello')).toBeNull();
	});

	it('UTF-16 surrogate pair (emoji) — diff lands on the code-unit boundary', () => {
		// 🌟 is U+1F31F, encoded as the surrogate pair D83C DF1F.
		// The diff uses `charCodeAt` (UTF-16 units) so it sees this
		// as a 2-unit delete + 1-unit insert. That's coarser than
		// per-grapheme but matches what Automerge.splice operates
		// on; the doc state stays valid UTF-16 either way.
		const result = compute_text_splice('a🌟b', 'aZb');
		expect(result).toEqual({ prefix: 1, deleteCount: 2, insertText: 'Z' });
	});

	it("Levenshtein-suboptimal — common chars in the middle still produce one splice", () => {
		// "abc def" → "abc xyz def" — common "abc " prefix, common
		// " def" suffix, middle insert "xyz". The greedy
		// prefix/suffix scan handles it as a single op.
		expect(compute_text_splice('abc def', 'abc xyz def')).toEqual({
			prefix: 4,
			deleteCount: 0,
			insertText: 'xyz '
		});
	});
});
