import type Command from './Command.svelte.js';

const MODIFIER_KEYS = ['meta', 'ctrl', 'alt', 'shift'] as const;
type ModifierKey = (typeof MODIFIER_KEYS)[number];

const MODIFIER_EVENT_KEYS: Record<ModifierKey, keyof KeyboardEvent> = {
	meta: 'metaKey',
	ctrl: 'ctrlKey',
	alt: 'altKey',
	shift: 'shiftKey'
};

/**
 * A keymap maps a comma-separated `<key_combo>` string to a list of
 * commands that get tried in order at runtime. Examples of valid
 * combos: `'meta+e,ctrl+e'`, `'meta+shift+a'`. Invalid:
 * `'meta+e+a'` (must have exactly one non-modifier key).
 */
export type KeyMap = Record<string, Command[]>;

/**
 * Identity helper for keymaps: validates the combo grammar at
 * setup time so a malformed entry blows up loudly, then returns
 * the keymap so a caller can write
 *
 *   `const my_map = define_keymap({ 'meta+s': [save_cmd] })`
 *
 * The runtime check catches typos like `'meta+e+a'` that would
 * otherwise silently never fire.
 */
export function define_keymap(keymap: KeyMap): KeyMap {
	for (const [key_combo] of Object.entries(keymap)) {
		const alternatives = key_combo.split(',');

		for (const alternative of alternatives) {
			const parts = alternative.trim().toLowerCase().split('+');
			const non_modifiers = parts.filter((part) => !(MODIFIER_KEYS as readonly string[]).includes(part));

			if (non_modifiers.length !== 1) {
				throw new Error(
					`Invalid key combo: "${alternative}". Must have exactly one non-modifier key. Found: ${non_modifiers.length}`
				);
			}
		}
	}
	return keymap;
}

/**
 * Match a `KeyboardEvent` against a combo string. `'meta+e,ctrl+e'`
 * matches either Cmd+E *or* Ctrl+E (but not both modifiers together).
 */
function matches_key_combo(key_combo: string, event: KeyboardEvent): boolean {
	const alternatives = key_combo.split(',');

	return alternatives.some((alternative) => {
		const parts = alternative.trim().toLowerCase().split('+');
		const modifiers = parts.filter((part) =>
			(MODIFIER_KEYS as readonly string[]).includes(part)
		) as ModifierKey[];
		const non_modifier = parts.find(
			(part) => !(MODIFIER_KEYS as readonly string[]).includes(part)
		);

		const modifiers_match = modifiers.every((mod) => event[MODIFIER_EVENT_KEYS[mod]]);

		const no_extra_modifiers = MODIFIER_KEYS.every((mod) => {
			if (modifiers.includes(mod)) return true;
			return !event[MODIFIER_EVENT_KEYS[mod]];
		});

		const key_matches = event.key.toLowerCase() === non_modifier;
		return modifiers_match && no_extra_modifiers && key_matches;
	});
}

/**
 * Walk the registered keymap, find the first enabled command whose
 * combo matches the event, execute it. Supports both sync and async
 * `execute()`s — async errors are logged but never crash the app.
 */
function handle_key_map(key_map: KeyMap, event: KeyboardEvent): boolean {
	for (const [key_combo, commands] of Object.entries(key_map)) {
		if (matches_key_combo(key_combo, event)) {
			const enabled_command = commands.find((cmd) => cmd.is_enabled());
			if (enabled_command) {
				event.preventDefault();

				const result = enabled_command.execute();

				if (result instanceof Promise) {
					result.catch((err) => {
						console.error('Command execution failed:', err);
					});
				}

				return true;
			}
		}
	}
	return false;
}

/**
 * Manages keyboard shortcuts via a stack of scopes. Higher scopes
 * (pushed last) get first crack at each event. App-level shortcuts
 * sit at the bottom, contextual ones (toolbar open, modal focused,
 * editor focused) push on top as those contexts gain focus.
 *
 *   const mapper = new KeyMapper();
 *   mapper.push_scope(app_keymap);       // always active
 *   mapper.push_scope(editor_keymap);    // when editor focused
 *   mapper.pop_scope();                  // when editor blurs
 */
export class KeyMapper {
	scope_stack: KeyMap[] = [];
	skip_onkeydown = false;

	push_scope(keymap: KeyMap): void {
		this.scope_stack.push(keymap);
	}

	pop_scope(): KeyMap | undefined {
		return this.scope_stack.pop();
	}

	handle_keydown(event: KeyboardEvent): void {
		// Temporarily disabled, e.g. while IME character composition.
		if (this.skip_onkeydown) return;
		// Try from most specific (top of stack) to most general.
		for (let i = this.scope_stack.length - 1; i >= 0; i--) {
			if (handle_key_map(this.scope_stack[i], event)) {
				return;
			}
		}
	}
}
