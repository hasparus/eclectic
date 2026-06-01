import type { Annotation, AnnotatedText, SelectionRange, Selection, NodeId, DocumentSchema, Document, DocumentNode } from './types.d.ts';

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Detect if the current browser is on a mobile device. */
export function is_mobile_browser(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return false;
	}

	const user_agent = navigator.userAgent;
	return (
		/iPhone|iPad|iPod|Android|Mobile/i.test(user_agent) ||
		'ontouchstart' in window ||
		navigator.maxTouchPoints > 0
	);
}

// ‼️ UNUSED UTILITY BELOW ‼️
/** Detect if the current browser is Chrome on desktop. */
export function is_chrome_desktop_browser(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return false;
	}
	const user_agent = navigator.userAgent;
	const is_chrome = user_agent.includes('Chrome') && !user_agent.includes('Edg');
	const is_mobile = is_mobile_browser();
	return is_chrome && !is_mobile;
}

/**
 * Grapheme-cluster character count via `Intl.Segmenter` — emojis
 * and other complex Unicode sequences count as single characters.
 *
 * @example
 *   get_char_length('Hello') // 5
 *   get_char_length('a😀b') // 3 (not 4)
 *   get_char_length('👋🏽') // 1 (skin tone modifier merged)
 */
export function get_char_length(str: string): number {
	return [...SEGMENTER.segment(str)].length;
}

// ‼️ UNUSED UTILITY BELOW ‼️
/** Character at the given index, grapheme-aware. */
export function get_char_at(str: string, index: number): string {
	const segments = [...SEGMENTER.segment(str)];
	return segments[index].segment;
}

/**
 * Grapheme-aware slice: `[start, end)` positions count grapheme
 * clusters rather than UTF-16 code units, so emoji stay intact.
 */
export function char_slice(str: string, start: number, end?: number): string {
	const segments = [...SEGMENTER.segment(str)];
	return segments
		.slice(start, end)
		.map((s) => s.segment)
		.join('');
}

/**
 * Convert a UTF-16 code-unit offset (what DOM selections use)
 * into a grapheme-cluster offset (what svedit operates on).
 */
export function utf16_to_char_offset(str: string, utf16_offset: number): number {
	const segments = [...SEGMENTER.segment(str)];
	let char_offset = 0;
	let utf16_count = 0;

	for (const segment of segments) {
		if (utf16_count >= utf16_offset) break;
		utf16_count += segment.segment.length;
		if (utf16_count > utf16_offset) break;
		char_offset++;
	}

	return char_offset;
}

/** Inverse of `utf16_to_char_offset`. */
export function char_to_utf16_offset(str: string, char_offset: number): number {
	const segments = [...SEGMENTER.segment(str)];
	let utf16_offset = 0;

	for (let i = 0; i < Math.min(char_offset, segments.length); i++) {
		utf16_offset += segments[i].segment.length;
	}

	return utf16_offset;
}

/**
 * Split an annotated text at a grapheme position. Annotations
 * spanning the split point are divided and their offsets rebased
 * on each side.
 */
export function split_annotated_text(
	text_with_annotations: AnnotatedText,
	at_position: number
): [AnnotatedText, AnnotatedText] {
	const { text, annotations } = text_with_annotations;

	const left_text = char_slice(text, 0, at_position);
	const right_text = char_slice(text, at_position);

	const left_annotations: Annotation[] = [];
	const right_annotations: Annotation[] = [];

	for (const { start_offset, end_offset, node_id } of annotations) {
		if (end_offset <= at_position) {
			left_annotations.push({ start_offset, end_offset, node_id });
		} else if (start_offset >= at_position) {
			right_annotations.push({
				start_offset: start_offset - at_position,
				end_offset: end_offset - at_position,
				node_id
			});
		} else {
			left_annotations.push({ start_offset, end_offset: at_position, node_id });
			right_annotations.push({ start_offset: 0, end_offset: end_offset - at_position, node_id });
		}
	}

	return [
		{ text: left_text, annotations: left_annotations },
		{ text: right_text, annotations: right_annotations }
	];
}

/**
 * Join two annotated texts. Second-text annotation offsets shift
 * by the first text's grapheme length. Adjacent annotations of
 * the same `node_id` are merged.
 */
export function join_annotated_text(
	first_text: AnnotatedText,
	second_text: AnnotatedText
): AnnotatedText {
	const { text: first_text_content, annotations: first_annotations } = first_text;
	const { text: second_text_content, annotations: second_annotations } = second_text;

	const joined_text = first_text_content + second_text_content;

	const joined_annotations: Annotation[] = [...first_annotations];

	const offset = get_char_length(first_text_content);
	for (const { start_offset, end_offset, node_id } of second_annotations) {
		const shifted_annotation: Annotation = {
			start_offset: start_offset + offset,
			end_offset: end_offset + offset,
			node_id
		};

		const last_annotation = joined_annotations[joined_annotations.length - 1];
		if (
			last_annotation &&
			last_annotation.end_offset === shifted_annotation.start_offset &&
			last_annotation.node_id === shifted_annotation.node_id
		) {
			last_annotation.end_offset = shifted_annotation.end_offset;
		} else {
			joined_annotations.push(shifted_annotation);
		}
	}

	return { text: joined_text, annotations: joined_annotations };
}

/**
 * snake_case → PascalCase.
 *
 * @example  snake_to_pascal('list_item') // 'ListItem'
 */
export function snake_to_pascal(str: string): string {
	return str
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('');
}

/**
 * Depth-first traversal of the node graph starting at `node_id`.
 * Returns a structurally-cloned list of every reachable node in
 * post-order. Cycles are guarded by a `visited` set.
 */
export function traverse(
	node_id: NodeId,
	schema: DocumentSchema,
	nodes: Document['nodes']
): DocumentNode[] {
	const json: DocumentNode[] = [];
	const visited: Record<string, boolean> = {};
	const visit = (node: any): void => {
		if (!node || visited[node.id]) {
			return;
		}
		visited[node.id] = true;
		for (const [property_name, value] of Object.entries(node)) {
			const property_definition = (schema as any)[node.type].properties[property_name];

			if (property_definition?.type === 'node_array') {
				for (const v of value as unknown[]) {
					if (typeof v === 'string') {
						visit(nodes[v]);
					}
				}
			} else if (property_definition?.type === 'node') {
				visit(nodes[value as NodeId]);
			} else if (property_definition?.type === 'annotated_text') {
				for (const annotation of (value as AnnotatedText).annotations) {
					visit(nodes[annotation.node_id]);
				}
			}
		}
		json.push(structuredClone(node));
	};
	visit(nodes[node_id]);
	return json;
}

/**
 * Normalised range for a text or node selection — start ≤ end
 * regardless of selection direction. Returns null for property
 * selections (which don't carry offsets).
 */
export function get_selection_range(selection?: Selection | null): SelectionRange | null {
	if (selection && selection.type !== 'property') {
		return {
			start_offset: Math.min(selection.anchor_offset, selection.focus_offset),
			end_offset: Math.max(selection.anchor_offset, selection.focus_offset)
		};
	} else {
		return null;
	}
}

/** True if the selection is a text/node selection whose endpoints coincide. */
export function is_selection_collapsed(selection?: Selection | null): boolean {
	if (selection && selection.type !== 'property') {
		return selection.anchor_offset === selection.focus_offset;
	} else {
		return false;
	}
}
