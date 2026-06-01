import { split_annotated_text, join_annotated_text, get_char_length } from './utils.js';
import { get_default_node_type } from './doc_utils.js';
import type Transaction from './Transaction.svelte.js';
import type { DocumentPath, AnnotatedText } from './types.d.ts';

/** Set multiple properties on a node via a transaction. */
export function set_properties(
	tr: Transaction,
	path: DocumentPath,
	properties: Record<string, unknown>
): void {
	for (const [key, value] of Object.entries(properties)) {
		tr.set([...path, key], value);
	}
}

/**
 * Split the currently-selected text node at the caret. The right
 * half becomes a new node inserted just after the original; the
 * caret moves to the start of the new node.
 *
 * Returns `false` (no-op) if the selection isn't inside a text
 * node that's itself sitting in a `node_array`.
 */
export function break_text_node(tr: Transaction): boolean {
	const selection = tr.selection;
	if (selection?.type !== 'text') return false;

	const node = tr.get(selection.path.slice(0, -1)) as any;
	if (tr.kind(node) !== 'text') return false;
	const inspected = tr.inspect(selection.path.slice(0, -2)) as { type?: string } | undefined;
	const is_inside_node_array = inspected?.type === 'node_array';
	if (!is_inside_node_array) return false;
	const node_array_prop = selection.path.at(-3) as string;
	const node_array_node = tr.get(selection.path.slice(0, -3)) as any;

	if (selection.anchor_offset !== selection.focus_offset) {
		tr.delete_selection();
	}

	const split_at_position = (tr.selection as { anchor_offset: number }).anchor_offset;
	const content = tr.get(selection.path) as AnnotatedText;
	const [left_text, right_text] = split_annotated_text(content, split_at_position);

	tr.set([node.id, 'content'], left_text);

	const node_insert_position = {
		type: 'node' as const,
		path: (tr.selection as { path: DocumentPath }).path.slice(0, -2),
		anchor_offset: parseInt(String((tr.selection as { path: DocumentPath }).path.at(-2)), 10) + 1,
		focus_offset: parseInt(String((tr.selection as { path: DocumentPath }).path.at(-2)), 10) + 1
	};

	// TODO: Only use default_node_type when caret is at the end of
	const node_array_property_definition = (tr.schema as Record<string, any>)[node_array_node.type]
		.properties[node_array_prop];
	const target_node_type = get_default_node_type(node_array_property_definition);

	if (!target_node_type) {
		console.warn(
			'Cannot determine target node type for break_text_node - no default_ref_type and multiple node_types'
		);
		return false;
	}

	tr.set_selection(node_insert_position);

	(tr.config as { inserters: Record<string, (tr: Transaction, content?: AnnotatedText) => void> })
		.inserters[target_node_type](tr, right_text);
	return true;
}

/**
 * Join the current text node with its previous sibling. The
 * predecessor absorbs this node's content; the caret lands at the
 * join point. If there's no predecessor and the current node is
 * empty, delete the empty node.
 */
export function join_text_node(tr: Transaction): boolean {
	const selection = tr.selection;
	if (selection?.type !== 'text') return false;

	const node = tr.get(selection.path.slice(0, -1)) as any;
	if (tr.kind(node) !== 'text') return false;
	const inspected = tr.inspect(selection.path.slice(0, -2)) as { type?: string } | undefined;
	const is_inside_node_array = inspected?.type === 'node_array';
	if (!is_inside_node_array) return false;

	const node_index = parseInt(String((tr.selection as { path: DocumentPath }).path.at(-2)), 10);

	let can_join = false;
	let predecessor_node: any = null;

	if (node_index > 0) {
		const previous_text_path = [...(tr.selection as { path: DocumentPath }).path.slice(0, -2), node_index - 1];
		predecessor_node = tr.get(previous_text_path);
		can_join = tr.kind(predecessor_node) === 'text';
	}

	if (!can_join && node.content.text === '') {
		tr.set_selection({
			type: 'node',
			path: (tr.selection as { path: DocumentPath }).path.slice(0, -2),
			anchor_offset: node_index,
			focus_offset: node_index + 1
		});
		tr.delete_selection();
		return true;
	}

	if (!can_join) {
		return false;
	}

	const previous_text_path = [...(tr.selection as { path: DocumentPath }).path.slice(0, -2), node_index - 1];
	const joined_text = join_annotated_text(predecessor_node.content, node.content);

	const caret_position = get_char_length(predecessor_node.content.text);

	tr.set([predecessor_node.id, 'content'], joined_text);

	tr.set_selection({
		type: 'node',
		path: (tr.selection as { path: DocumentPath }).path.slice(0, -2),
		anchor_offset: node_index,
		focus_offset: node_index + 1
	});

	tr.delete_selection();

	tr.set_selection({
		type: 'text',
		path: [...previous_text_path, 'content'],
		anchor_offset: caret_position,
		focus_offset: caret_position
	});
	return true;
}

/**
 * Insert the default node type at the current node-array caret.
 * No-op if the selection isn't a collapsed `node` selection.
 */
export function insert_default_node(tr: Transaction): boolean {
	const selection = tr.selection;

	if (selection?.type !== 'node' || selection.anchor_offset !== selection.focus_offset) {
		return false;
	}

	const path = selection.path;
	const node_array_node = tr.get(path.slice(0, -1)) as any;
	const property_name = path.at(-1) as string;

	const property_definition = (tr.schema as Record<string, any>)[node_array_node.type].properties[
		property_name
	];
	const default_type = get_default_node_type(property_definition);

	const inserters = (tr.config as { inserters?: Record<string, (tr: Transaction) => void> })
		?.inserters;
	if (default_type && inserters?.[default_type]) {
		inserters[default_type](tr);
		return true;
	} else {
		throw new Error(`No inserter function available for default node type '${default_type}'`);
	}
}
