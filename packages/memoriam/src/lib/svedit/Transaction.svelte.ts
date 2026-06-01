import {
	get_char_length,
	char_slice,
	traverse,
	get_selection_range,
	is_selection_collapsed
} from './utils.js';
import { join_text_node } from './transforms.svelte.js';
import {
	get as doc_get,
	property_type as doc_property_type,
	kind as doc_kind,
	inspect as doc_inspect,
	apply_op,
	count_references_excluding_deleted,
	validate_node,
	get_active_annotation,
	validate_selection
} from './doc_utils.js';
import type {
	NodeId,
	Selection,
	Document,
	DocumentSchema,
	DocumentPath,
	DocumentNode,
	Annotation,
	AnnotatedText,
	NodeKind,
	PropertyDefinition
} from './types.d.ts';
import type { SessionConfig } from './Session.svelte.js';

type Op = ['set', DocumentPath, unknown] | ['create', DocumentNode] | ['delete', NodeId];

/**
 * Transaction class for managing atomic document operations with undo/redo support.
 *
 * A Transaction provides a way to group multiple document operations (create, delete, set)
 * into a single atomic unit that can be applied or rolled back as one. It maintains
 * both forward operations and their inverse operations for undo functionality.
 *
 * @example
 * ```ts
 * const tr = session.tr;
 * tr.set(['node_1', 'title'], 'New Title');
 * tr.create({id: 'node_2', type: 'paragraph', content: 'Hello'});
 * session.apply(tr); // Applies all operations atomically
 * ```
 */
export default class Transaction {
	schema: DocumentSchema;
	doc: Document;
	selection: Selection | null;
	config: SessionConfig;
	ops: Op[];
	inverse_ops: Op[];
	selection_before: Selection | null;

	/**
	 * Creates a new Transaction with the given state.
	 */
	constructor(
		schema: DocumentSchema,
		doc: Document,
		selection: Selection | null,
		config: SessionConfig
	) {
		this.schema = schema;
		this.doc = doc;
		this.selection = selection;
		this.config = config;
		// Here we track the ops during the transaction
		this.ops = [];
		this.inverse_ops = [];
		// Remember the selection before the transaction started
		this.selection_before = selection;
	}

	/**
	 * Gets a value from the document at the specified path.
	 */
	get(path: DocumentPath | string): any {
		return doc_get(this.schema, this.doc, path);
	}

	/**
	 * Gets the type of a property from the schema.
	 */
	property_type(type: string, property: string): string {
		return doc_property_type(this.schema, type, property);
	}

	/**
	 * Determines the kind of a node ('block', 'text', or 'annotation').
	 */
	kind(node: DocumentNode): NodeKind {
		return doc_kind(this.schema, node);
	}

	/**
	 * Inspects a path to get metadata about the value at that location.
	 */
	inspect(path: DocumentPath): { kind: 'property' | 'node'; [key: string]: unknown } {
		return doc_inspect(this.schema, this.doc, path) as {
			kind: 'property' | 'node';
			[key: string]: unknown;
		};
	}

	/**
	 * Generates a new unique ID using the config's generate_id function.
	 */
	generate_id(): string {
		return this.config.generate_id!();
	}

	/**
	 * Validates a node against the document schema.
	 * @throws {Error} Throws if the node is invalid
	 */
	validate_node(node: DocumentNode): void {
		validate_node(node, this.schema, this.doc.nodes);
	}

	/**
	 * Gets all nodes referenced by a given node (recursively).
	 */
	get_referenced_nodes(node_id: NodeId): NodeId[] {
		const traversed_nodes = traverse(node_id, this.schema, this.doc.nodes);
		return traversed_nodes.slice(0, -1).map((node) => node.id);
	}

	/**
	 * Gets the available annotation types for the current selection.
	 */
	get available_annotation_types(): string[] {
		if (this.selection?.type !== 'text') return [];
		const path = this.selection.path;
		const property_definition = this.inspect(path) as { node_types?: string[] };
		return property_definition.node_types || [];
	}

	/**
	 * Returns the annotation object that is currently "under the caret".
	 * NOTE: Annotations in Svedit are exclusive, so there can only be one active_annotation
	 */
	active_annotation(annotation_type?: string): Annotation | null {
		return get_active_annotation(this.schema, this.doc, this.selection, annotation_type);
	}

	/**
	 * Applies an operation to the document (internal).
	 */
	private _apply_op(op: Op): void {
		this.doc = apply_op(this.doc, op);
	}

	/**
	 * Sets a property of a node to a new value.
	 *
	 * This is the core operation for modifying document properties. It records
	 * both the forward operation and its inverse for undo support.
	 *
	 * @example
	 * ```ts
	 * tr.set(["list_1", "list_items"], [1, 2, 3]);
	 * tr.set(["page_1", "body", "0", "description"], {text: "Hello world", annotations: []});
	 * ```
	 */
	set(path: DocumentPath, value: unknown): this {
		const node = this.get(path.slice(0, -1)) as DocumentNode;

		// Turns ["page_1", "body", "0", "description"]
		// into ["paragraph_1", "description"].
		// Important to keep changes of multiple ops invertible.
		const normalized_path: DocumentPath = [node.id, path.at(-1) as string | number];

		// Just to be sure, make a deep copy of the old value
		const property_key = path.at(-1);
		if (property_key === undefined) {
			throw new Error('Invalid path: cannot get property key');
		}
		const property_key_str = String(property_key);
		const previous_value = structuredClone($state.snapshot(node[property_key_str]));

		// Collect node IDs that might need to be deleted after the set operation
		const prop_type = this.property_type(node.type, property_key_str);
		let removed_node_ids: NodeId[] = [];

		if (prop_type === 'node' && typeof previous_value === 'string' && previous_value !== value) {
			removed_node_ids = [previous_value];
		} else if (
			prop_type === 'node_array' &&
			Array.isArray(previous_value) &&
			Array.isArray(value)
		) {
			// Only include node IDs that were in previous_value but are not in the new value
			removed_node_ids = previous_value.filter((id) => !value.includes(id));
		}

		const op: Op = ['set', normalized_path, value];
		this.ops.push(op);
		this.inverse_ops.push(['set', normalized_path, previous_value]);
		this._apply_op(op);

		for (const removed_node_id of removed_node_ids) {
			// NOTE: This implicitly deletes childnodes as well, given that they are no longer referenced.
			this.delete(removed_node_id);
		}

		return this;
	}

	// Takes a subgraph and constructs new nodes from it
	// NOTE: all ids will be mapped to new unique ids.
	// NOTE: Omitted properties will be populated with default values.
	build(node_id: NodeId, nodes: Record<string, DocumentNode>): NodeId {
		const depth_first_nodes = traverse(node_id, this.schema, nodes);
		// This maps original ids to newly generated ids
		const id_map: Record<string, string> = {};

		for (const node of depth_first_nodes) {
			const new_id = this.generate_id();
			id_map[node.id] = new_id;
			const new_node: DocumentNode = { ...node, id: new_id };
			const node_schema = this.schema[node.type];

			// Update all property references to use new IDs
			for (const [property_name, property_definition] of Object.entries(node_schema.properties) as [
				string,
				PropertyDefinition
			][]) {
				const prop_type = property_definition.type;
				const value = node[property_name];

				// Apply default values
				if (prop_type === 'node_array') {
					// [] is the default value for node arrays
					new_node[property_name] = Array.isArray(value)
						? value.map((ref_id: string) => id_map[ref_id])
						: [];
				} else if (prop_type === 'node') {
					// null is the default value for node references
					new_node[property_name] = typeof value === 'string' ? id_map[value] : null;
				} else if (prop_type === 'annotated_text') {
					if (value) {
						const annotated = value as AnnotatedText;
						const annotations = annotated.annotations.map((annotation) => {
							const { start_offset, end_offset, node_id } = annotation;
							return { start_offset, end_offset, node_id: id_map[node_id] || node_id };
						});
						new_node[property_name] = { text: annotated.text, annotations };
					} else {
						new_node[property_name] = { text: '', annotations: [] };
					}
				} else if (prop_type === 'string') {
					new_node[property_name] =
						value ?? (property_definition as { default?: string }).default ?? '';
				} else if (prop_type === 'integer') {
					new_node[property_name] =
						value ?? (property_definition as { default?: number }).default ?? 0;
				} else if (prop_type === 'number') {
					new_node[property_name] =
						value ?? (property_definition as { default?: number }).default ?? 0;
				} else if (prop_type === 'boolean') {
					new_node[property_name] =
						value ?? (property_definition as { default?: boolean }).default ?? false;
				} else if (['integer_array', 'number_array'].includes(prop_type)) {
					new_node[property_name] =
						value ?? (property_definition as { default?: number[] }).default ?? [];
				} else if (prop_type === 'string_array') {
					new_node[property_name] =
						value ?? (property_definition as { default?: string[] }).default ?? [];
				}
			}

			this.create(new_node);
		}

		return id_map[depth_first_nodes.at(-1)!.id];
	}

	/**
	 * Creates a new node in the document.
	 *
	 * The node must have a valid id and must not already exist in the document.
	 * The node is validated against the document schema before creation.
	 *
	 * @throws {Error} If the node ID is invalid or if the node already exists
	 *
	 * @example
	 * ```ts
	 * tr.create({
	 *   id: 'para_123',
	 *   type: 'paragraph',
	 *   content: ['Hello world', []]
	 * });
	 * ```
	 */
	create(node: DocumentNode): this {
		// Validate node against schema
		this.validate_node(node);

		if (this.get(node.id)) {
			throw new Error('Node with id ' + node.id + ' already exists');
		}

		const op: Op = ['create', node];
		this.ops.push(op);
		this.inverse_ops.push(['delete', node.id]);
		this._apply_op(op);
		return this;
	}

	/**
	 * Deletes a node from the document by its ID.
	 *
	 * The node's current state is captured for undo support before deletion.
	 */
	delete(id: NodeId): this {
		const previous_value = this.get(id) as DocumentNode | undefined;
		if (!previous_value) {
			console.warn(`Deletion of node ${id} skipped, as it does not exist.`);
			return this;
		}
		// Get nodes referenced by this node BEFORE deleting it.
		const referenced_nodes = this.get_referenced_nodes(id);
		const op: Op = ['delete', id];
		this.ops.push(op);
		this.inverse_ops.push(['create', previous_value]);
		this._apply_op(op);
		// Cascade delete any nodes that are now orphaned after removing this node
		this._cascade_delete_unreferenced_nodes(referenced_nodes);
		return this;
	}

	/**
	 * Sets the document selection.
	 * @throws {Error} Throws if the selection is invalid or out of bounds
	 */
	set_selection(selection: Selection | null): this {
		this._validate_selection(selection);
		this.selection = selection;
		return this;
	}

	/**
	 * Validates a selection against the current document state.
	 * @throws {Error} Throws if the selection is invalid
	 */
	private _validate_selection(selection: Selection | null): void {
		validate_selection(selection, this as unknown as Parameters<typeof validate_selection>[1]);
	}

	/**
	 * Adds, updates, or removes text annotations in the current selection.
	 *
	 * Handles various annotation scenarios including adding new annotations,
	 * updating existing ones (especially for links), and removing annotations
	 * when conflicting types are applied.
	 *
	 * @example
	 * ```ts
	 * // Add a link annotation
	 * tr.annotate_text('link', { href: 'https://example.com' });
	 *
	 * // Add emphasis
	 * tr.annotate_text('emphasis', {});
	 * ```
	 */
	annotate_text(
		annotation_type: string,
		annotation_properties: Record<string, unknown> = {}
	): this {
		if (this.selection?.type !== 'text') return this;

		const range = get_selection_range(this.selection)!;
		const annotated_text = structuredClone(
			$state.snapshot(this.get(this.selection.path))
		) as AnnotatedText;
		const annotations = annotated_text.annotations;
		const existing_annotation = this.active_annotation();
		const existing_annotation_same_type = this.active_annotation(annotation_type);

		if (existing_annotation) {
			// If there's an existing annotation of the same type, remove it
			if (existing_annotation_same_type) {
				const index = annotations.findIndex(
					(anno) =>
						anno.start_offset === existing_annotation.start_offset &&
						anno.end_offset === existing_annotation.end_offset
				);
				if (index !== -1) {
					// Remove the annotation node from the graph
					this.delete(annotations[index].node_id);
					annotations.splice(index, 1);
				}
			} else {
				// If there's an annotation of a different type, don't add a new one
				return this;
			}
		} else {
			if (is_selection_collapsed(this.selection)) {
				console.log('Annotations can only be added to expanded text selections.');
				return this;
			}
			if (!this.available_annotation_types.includes(annotation_type)) {
				console.log(`Annotation type ${annotation_type} is not allowed here.`);
				return this;
			}
			const new_annotation_node: DocumentNode = {
				id: this.generate_id(),
				type: annotation_type,
				...annotation_properties
			};
			this.create(new_annotation_node);
			// If there's no existing annotation, add the new one
			annotations.push({
				start_offset: range.start_offset,
				end_offset: range.end_offset,
				node_id: new_annotation_node.id
			});
		}

		// Update the annotated text
		this.set(this.selection.path, annotated_text);
		return this;
	}

	/**
	 * Deletes the currently selected text or nodes.
	 *
	 * Behavior depends on selection type:
	 * - For node selections: Removes selected nodes and cascades deletion of unreferenced nodes
	 * - For text selections: Removes selected text and adjusts annotations accordingly
	 * - For collapsed selections: Deletes the previous character/node (backward) or next character/node (forward)
	 * - Property selections are ignored: Those are best handled via commands + keyboard shortcuts.
	 */
	delete_selection(direction: 'backward' | 'forward' = 'backward'): this {
		if (!this.selection || this.selection.type === 'property') return this;
		const path = this.selection.path;

		// Get the start and end indices for the selection
		let start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
		let end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
		let length = 0;

		if (this.selection?.type === 'text') {
			const text_content = (this.get(this.selection.path) as AnnotatedText).text;
			length = get_char_length(text_content);
		} else if (this.selection?.type === 'node') {
			const node_array = this.get(this.selection.path) as unknown[];
			length = node_array.length;
		}

		// If selection is collapsed we delete the previous char/node (backward)
		// or the next char/node (forward)
		if (start === end) {
			if (direction === 'backward' && start > 0) {
				start = start - 1;
			} else if (direction === 'forward' && end < length) {
				end = end + 1;
			} else if (direction === 'backward' && start === 0) {
				join_text_node(this);
				return this;
			} else if (direction === 'forward' && end === length) {
				// At end of text - try to join with next text node
				const node_index = parseInt(String(this.selection.path.at(-2)), 10);
				const successor_node = this.get([
					...this.selection.path.slice(0, -2),
					node_index + 1
				]) as DocumentNode | undefined;
				// Check if next node is a text node
				if (successor_node && this.kind(successor_node) === 'text') {
					// Set selection to beginning of next text node
					this.set_selection({
						type: 'text',
						path: [...this.selection.path.slice(0, -2), node_index + 1, 'content'],
						anchor_offset: 0,
						focus_offset: 0
					});
					// Use join_text_node to merge with previous node
					join_text_node(this);
				}
				return this;
			}
		}

		if (this.selection.type === 'node') {
			const node_array = [...(this.get(path) as string[])];

			// Remove the selected nodes from the node_array
			node_array.splice(start, end - start);

			// Update the node_array in the entry (this implicitly records an op via this.set)
			// Note: this.set() will automatically cascade delete unreferenced nodes
			this.set(path, node_array);

			// Update the selection to point to the start of the deleted range
			this.selection = {
				type: 'node',
				path,
				anchor_offset: start,
				focus_offset: start
			};
		} else if (this.selection.type === 'text') {
			const path = this.selection.path;
			const text = structuredClone($state.snapshot(this.get(path))) as AnnotatedText;

			// Update the text content using character-based operations
			const original_text = text.text;
			text.text =
				char_slice(original_text, 0, start) +
				char_slice(original_text, end, get_char_length(original_text));

			// To mark annotation nodes for deletion.
			const _deleted_nodes: string[] = [];
			const deletion_length = end - start;
			const new_annotations = text.annotations
				.map((annotation): Annotation | null => {
					const annotation_start = annotation.start_offset;
					const annotation_end = annotation.end_offset;
					const node_id = annotation.node_id;

					// Case 1: Annotation is entirely before the deleted range - keep unchanged
					if (annotation_end <= start) {
						return annotation;
					}

					// Case 2: Annotation is entirely after the deleted range - shift it
					let new_start = annotation_start;
					if (annotation_start >= end) {
						new_start = annotation_start - deletion_length;
					} else if (annotation_start > start) {
						// Annotation starts inside deleted range
						new_start = start;
					}

					// Case 3: Annotation overlaps with deleted range - adjust end
					let new_end = annotation_end;
					if (annotation_end >= end) {
						new_end = annotation_end - deletion_length;
					} else if (annotation_end > start) {
						// Annotation ends inside deleted range
						new_end = start;
					}

					// If annotation is now empty, mark for deletion
					if (new_start >= new_end) {
						_deleted_nodes.push(node_id);
						return null;
					}

					return { start_offset: new_start, end_offset: new_end, node_id };
				})
				.filter((a): a is Annotation => a !== null);

			text.annotations = new_annotations;

			// Delete marked annotation nodes
			for (const node_id of _deleted_nodes) {
				this.delete(node_id);
			}

			this.set(path, text);

			// Update the selection to the new caret position
			this.selection = {
				type: 'text',
				path,
				anchor_offset: start,
				focus_offset: start
			};
		}

		return this;
	}

	/**
	 * Inserts nodes at the current node selection position.
	 *
	 * If the selection is expanded (not collapsed), first deletes the selected nodes
	 * before inserting the new ones.
	 */
	insert_nodes(node_ids: NodeId[]): this {
		if (this.selection?.type !== 'node') return this;

		// Unless caret is collapsed, delete the selected nodes as a first step
		if (this.selection.anchor_offset !== this.selection.focus_offset) {
			this.delete_selection();
		}

		const path = this.selection.path;
		const node_array = [...(this.get(path) as string[])];

		const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);

		// Insert the new nodes
		node_array.splice(start, 0, ...node_ids);
		this.set(path, node_array);

		this.selection = {
			type: 'node',
			path: [...this.selection.path],
			anchor_offset: start,
			focus_offset: start + node_ids.length
		};

		return this;
	}

	/**
	 * Inserts text at the current text selection position.
	 *
	 * Handles annotation adjustments when text is inserted, including:
	 * - Expanding annotations that contain the insertion point
	 * - Shifting annotations that come after the insertion point
	 * - Optionally applying new annotations to the inserted text
	 */
	insert_text(
		replaced_text: string,
		annotations: Annotation[] = [],
		nodes: Record<string, DocumentNode> = {}
	): this {
		if (this.selection?.type !== 'text') return this;

		// Unless selection is collapsed, delete the selected content
		// NOTE: This makes sure wrapped annotations are disposed correctly
		if (!is_selection_collapsed(this.selection)) {
			this.delete_selection();
		}

		const annotated_text = structuredClone(
			$state.snapshot(this.get(this.selection.path))
		) as AnnotatedText;
		const range = get_selection_range(this.selection)!;

		// Transform the plain text string using character-based operations
		const text = annotated_text.text;
		annotated_text.text =
			char_slice(text, 0, range.start_offset) +
			replaced_text +
			char_slice(text, range.end_offset);

		// Calculate the change in length
		const delta = get_char_length(replaced_text);

		const new_annotations = annotated_text.annotations.map((annotation): Annotation => {
			const annotation_start = annotation.start_offset;
			const annotation_end = annotation.end_offset;
			const node_id = annotation.node_id;

			// Annotation is entirely before the insertion point
			if (annotation_end <= range.start_offset) {
				return annotation;
			}

			// Insertion point is inside the annotation (not at the start) - extend it
			if (annotation_start < range.start_offset && annotation_end >= range.start_offset) {
				return {
					start_offset: annotation_start,
					end_offset: annotation_end + delta,
					node_id
				};
			}

			// Annotation is entirely after the insertion point - shift it
			if (annotation_start >= range.start_offset) {
				return {
					start_offset: annotation_start + delta,
					end_offset: annotation_end + delta,
					node_id
				};
			}
			return annotation;
		});

		annotated_text.annotations = new_annotations;
		this.set(this.selection.path, annotated_text); // this will update the current state and create a history entry

		// Setting the selection automatically triggers a re-render of the corresponding DOMSelection.
		const new_selection: Selection = {
			type: 'text',
			path: this.selection.path,
			anchor_offset: range.start_offset + get_char_length(replaced_text),
			focus_offset: range.start_offset + get_char_length(replaced_text)
		};
		this.selection = new_selection;

		// Now we apply annotations if there are any, but only if there's no active annotation
		// at the current collapsed caret
		if (!this.active_annotation() && annotations.length > 0) {
			const sel = this.selection;
			const new_annotation_entries = annotations
				.map((annotation): Annotation | null => {
					const original_annotation_node = nodes[annotation.node_id];
					const text_property_definition = this.inspect(sel.path) as unknown as { node_types: string[] };
					if (text_property_definition.node_types.includes(original_annotation_node.type)) {
						const new_annotation_node_id = this.build(annotation.node_id, nodes);
						return {
							start_offset: range.start_offset + annotation.start_offset,
							end_offset: range.start_offset + annotation.end_offset,
							node_id: new_annotation_node_id
						};
					}
					return null;
				})
				.filter((a): a is Annotation => a !== null);
			const next_annotated_text = structuredClone(annotated_text);
			next_annotated_text.annotations =
				next_annotated_text.annotations.concat(new_annotation_entries);
			this.set(sel.path, next_annotated_text); // this will update the current state and create a history entry
		}

		return this;
	}

	/**
	 * Recursively deletes nodes that are no longer referenced in the document.
	 *
	 * This handles the cascade deletion of child nodes when their parent
	 * references are removed. Uses reference counting to determine which
	 * nodes are safe to delete.
	 */
	private _cascade_delete_unreferenced_nodes(potentially_orphaned_nodes: NodeId[]): void {
		const nodes_to_delete: Record<NodeId, boolean> = {};
		const to_check = [...potentially_orphaned_nodes];

		while (to_check.length > 0) {
			const node_id = to_check.pop();
			if (!node_id || nodes_to_delete[node_id]) continue;

			// Count references to this node, excluding nodes already marked for deletion
			const ref_count = this._count_references_excluding_deleted(node_id, nodes_to_delete);

			if (ref_count === 0) {
				// No more references, safe to delete this node
				nodes_to_delete[node_id] = true;

				// Also check all nodes referenced by this node
				const referenced_nodes = this.get_referenced_nodes(node_id);
				to_check.push(...referenced_nodes);
			}
		}

		// Now perform the actual deletions
		for (const node_id of Object.keys(nodes_to_delete)) {
			const previous_value = this.get([node_id]) as DocumentNode | undefined;
			if (previous_value) {
				const op: Op = ['delete', node_id];
				this.ops.push(op);
				this.inverse_ops.push(['create', previous_value]);
				this._apply_op(op);
			}
		}
	}

	/**
	 * Counts references to a node, excluding nodes that have been marked for deletion.
	 *
	 * This is used during cascade deletion to accurately count remaining references
	 * as nodes are being deleted.
	 */
	private _count_references_excluding_deleted(
		target_node_id: NodeId,
		nodes_to_delete: Record<NodeId, boolean>
	): number {
		return count_references_excluding_deleted(
			this.schema,
			this.doc,
			target_node_id,
			nodes_to_delete
		);
	}
}
