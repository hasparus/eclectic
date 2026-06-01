/**
 * Shared document utilities used by both Session and Transaction.
 *
 * These functions operate on the core document state (schema, doc,
 * selection, config) without any history management or transaction
 * tracking.
 */

import type {
	NodeId,
	DocumentPath,
	PrimitiveType,
	NodeProperty,
	NodeArrayProperty,
	NodeSchema,
	DocumentSchema,
	Selection,
	Annotation,
	Document,
	DocumentNode
} from './types.d.ts';
import { get_selection_range, get_char_length } from './utils.js';

/**
 * Identity function — keeps schema at runtime & makes IDE infer
 * types. Similar to a `define_schema` pattern but for document
 * schemas.
 */
export function define_document_schema<S extends Record<string, NodeSchema>>(schema: S): S {
	return schema;
}

/** Type guard for the set of primitive type names svedit recognises. */
export function is_primitive_type(type: string): type is PrimitiveType {
	return [
		'string',
		'number',
		'boolean',
		'integer',
		'datetime',
		'annotated_text',
		'string_array',
		'number_array',
		'boolean_array',
		'integer_array'
	].includes(type);
}

/**
 * Pick the default node type for a node / node_array property.
 * Returns null if the property has no `node_types` list, or it has
 * more than one candidate and no `default_node_type` override.
 */
export function get_default_node_type(
	property_definition: NodeProperty | NodeArrayProperty | undefined
): string | null {
	if (!property_definition || !property_definition.node_types) {
		return null;
	}

	return (
		property_definition.default_node_type ||
		(property_definition.node_types.length === 1 ? property_definition.node_types[0] : null)
	);
}

/**
 * Validate a document schema: every `node` / `node_array`
 * property's `node_types` must reference a node type that's defined
 * in the schema. Throws on the first violation.
 */
export function validate_document_schema(document_schema: DocumentSchema): void {
	for (const [node_type, node_schema] of Object.entries(document_schema as Record<string, NodeSchema>)) {
		for (const [prop_name, prop_def] of Object.entries(node_schema.properties)) {
			const def = prop_def as { type: string; node_types?: string[] };
			if (def.type === 'node' || def.type === 'node_array') {
				const missing_types = (def.node_types ?? []).filter(
					(ref_type) => !(ref_type in document_schema)
				);
				if (missing_types.length > 0) {
					throw new Error(
						`Node type "${node_type}" property "${prop_name}" references unknown node types: ${missing_types.join(', ')}. Available node types: ${Object.keys(document_schema).join(', ')}`
					);
				}
			}
		}
	}
}

/** Validate a primitive value against its schema type. */
function validate_primitive_value(type: PrimitiveType, value: unknown): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && !isNaN(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'integer':
			return Number.isInteger(value);
		case 'datetime':
			return typeof value === 'string' && !isNaN(Date.parse(value));
		case 'annotated_text':
			return (
				typeof value === 'object' &&
				value !== null &&
				typeof (value as { text?: unknown }).text === 'string' &&
				Array.isArray((value as { annotations?: unknown }).annotations)
			);
		case 'string_array':
			return Array.isArray(value) && value.every((v) => typeof v === 'string');
		case 'number_array':
			return Array.isArray(value) && value.every((v) => typeof v === 'number' && !isNaN(v));
		case 'boolean_array':
			return Array.isArray(value) && value.every((v) => typeof v === 'boolean');
		case 'integer_array':
			return Array.isArray(value) && value.every((v) => Number.isInteger(v));
		default:
			return false;
	}
}

function is_id_valid(id: unknown): boolean {
	return typeof id === 'string' && id.length > 0;
}

/**
 * Validate a node against its schema. Walks every property in the
 * node's schema definition and asserts the value matches. Node and
 * node_array references additionally check that the referenced ids
 * resolve to a node of an allowed type.
 *
 * Throws on the first violation; intended for use during
 * transactions to catch schema drift early.
 */
export function validate_node(
	node: DocumentNode,
	schema: DocumentSchema,
	all_nodes: Record<NodeId, DocumentNode> = {}
): void {
	if (!is_id_valid(node.id)) {
		throw new Error(`Node ${node.id} has an invalid id.`);
	}

	const sch = schema as Record<string, NodeSchema>;
	if (!node.type || !sch[node.type]) {
		throw new Error(`Node ${node.id} has an invalid type: ${node.type}`);
	}

	const node_schema = sch[node.type];

	for (const [prop_name, prop_def_raw] of Object.entries(node_schema.properties)) {
		const prop_def = prop_def_raw as { type: string; node_types?: string[] };
		const value = (node as Record<string, unknown>)[prop_name];

		if (is_primitive_type(prop_def.type)) {
			if (!validate_primitive_value(prop_def.type, value)) {
				throw new Error(
					`Node ${node.id} has an invalid property: ${prop_name} must be of type ${prop_def.type}.`
				);
			}
		}
		if (prop_def.type === 'node') {
			if (!is_id_valid(value)) {
				throw new Error(
					`Node ${node.id} has an invalid property: ${prop_name} must be a valid node id.`
				);
			}
			const referenced_node = all_nodes[value as NodeId];
			if (referenced_node && !(prop_def.node_types ?? []).includes(referenced_node.type)) {
				throw new Error(
					`Node ${node.id} property ${prop_name} references node ${value} of type ${referenced_node.type}, but only types [${(prop_def.node_types ?? []).join(', ')}] are allowed.`
				);
			}
		} else if (prop_def.type === 'node_array') {
			if (
				!Array.isArray(value) ||
				!value.every((id) => typeof id === 'string' && is_id_valid(id))
			) {
				throw new Error(
					`Node ${node.id} has an invalid property: ${prop_name} must be an array of node ids.`
				);
			}
			for (const ref_id of value as NodeId[]) {
				const referenced_node = all_nodes[ref_id];
				if (referenced_node && !(prop_def.node_types ?? []).includes(referenced_node.type)) {
					throw new Error(
						`Node ${node.id} property ${prop_name} references node ${ref_id} of type ${referenced_node.type}, but only types [${(prop_def.node_types ?? []).join(', ')}] are allowed.`
					);
				}
			}
		}
	}
}

/**
 * Get a value from the document at the specified path. `path` is
 * a sequence of node ids, property names, and array indices —
 * traversal is type-aware so `path = [page_id, 'children', 0]`
 * follows a node_array into a child node.
 *
 * Returns `any` because the result type depends on the path. Most
 * callers know what they expect.
 */
export function get(schema: DocumentSchema, doc: Document, path: DocumentPath | string): any {
	if (typeof path === 'string') {
		path = [path];
	}
	if (!(Array.isArray(path) && path.length >= 1)) {
		throw new Error(`Invalid path provided ${JSON.stringify(path)}`);
	}

	let val: any = doc.nodes[path[0] as NodeId];
	let val_type:
		| 'node'
		| 'node_array'
		| 'annotated_text'
		| 'value_array'
		| 'value'
		| 'annotation_array'
		| 'annotation' = 'node';

	for (let i = 1; i < path.length; i++) {
		const path_segment = path[i];
		const path_segment_str = String(path_segment);
		if (val_type === 'node') {
			if (property_type(schema, val.type, path_segment_str) === 'node_array') {
				val = val[path_segment];
				val_type = 'node_array';
			} else if (property_type(schema, val.type, path_segment_str) === 'annotated_text') {
				val = val[path_segment];
				val_type = 'annotated_text';
			} else if (property_type(schema, val.type, path_segment_str) === 'node') {
				val = doc.nodes[val[path_segment] as NodeId];
				val_type = 'node';
			} else if (
				['string_array', 'integer_array'].includes(
					property_type(schema, val.type, path_segment_str)
				)
			) {
				val = val[path_segment];
				val_type = 'value_array';
			} else {
				val = val[path_segment];
				val_type = 'value';
			}
		} else if (val_type === 'node_array') {
			val = doc.nodes[val[path_segment] as NodeId];
			val_type = 'node';
		} else if (val_type === 'value_array') {
			val = val[path_segment];
			val_type = 'value';
		} else if (val_type === 'annotated_text') {
			if (path_segment === 'text') {
				val = val.text;
				val_type = 'value';
			} else if (path_segment === 'annotations') {
				val = val.annotations;
				val_type = 'annotation_array';
			} else {
				throw new Error(
					`Invalid path segment "${path_segment}" for annotated_text. Use "text" or "annotations".`
				);
			}
		} else if (val_type === 'annotation_array') {
			val = val[path_segment];
			val_type = 'annotation';
		} else if (val_type === 'annotation') {
			if (path_segment === 'node_id') {
				val = doc.nodes[val.node_id];
				val_type = 'node';
			} else if (path_segment === 'start_offset') {
				val = val.start_offset;
				val_type = 'value';
			} else if (path_segment === 'end_offset') {
				val = val.end_offset;
				val_type = 'value';
			} else {
				throw new Error(
					`Invalid path segment "${path_segment}" for annotation. Use "start_offset", "end_offset", or "node_id".`
				);
			}
		}
	}
	return val;
}

/** Look up a property's type name in the schema. */
export function property_type(schema: DocumentSchema, type: string, property: string): string {
	if (typeof type !== 'string') throw new Error(`Invalid type ${type} provided`);
	if (typeof property !== 'string') throw new Error(`Invalid property ${property} provided`);

	if (property === 'type') return 'string';
	if (property === 'id') return 'string';

	const sch = schema as Record<string, NodeSchema>;
	if (!sch[type]) throw new Error(`Type ${type} not found in schema`);
	if (!sch[type].properties[property])
		throw new Error(`Property ${property} not found in type ${type}`);

	return (sch[type].properties[property] as { type: string }).type;
}

/** The schema-declared kind of a node. */
export function kind(
	schema: DocumentSchema,
	node: DocumentNode
): 'document' | 'block' | 'text' | 'annotation' {
	return (schema as Record<string, NodeSchema>)[node.type].kind as
		| 'document'
		| 'block'
		| 'text'
		| 'annotation';
}

/**
 * Inspect a path: returns either `{ kind: 'property', ... }`
 * (the property's schema definition) or `{ kind: 'node', ... }`
 * (the node's id / type / properties).
 */
export function inspect(
	schema: DocumentSchema,
	doc: Document,
	path: DocumentPath
): { kind: 'property' | 'node'; [key: string]: any } {
	const parent = path.length > 1 ? get(schema, doc, path.slice(0, -1)) : undefined;
	if (parent?.type) {
		const property_name = path.at(-1) as string;
		return {
			kind: 'property',
			name: property_name,
			...((schema as Record<string, NodeSchema>)[parent.type].properties[property_name] as object)
		};
	} else {
		const node = get(schema, doc, path);
		return {
			kind: 'node',
			id: node.id,
			type: node.type,
			properties: (schema as Record<string, NodeSchema>)[node.type]
		};
	}
}

/**
 * Apply a single op to a document and return the new document.
 * Uses copy-on-write semantics so callers can rely on the previous
 * doc reference staying intact.
 */
export function apply_op(doc: Document, op: unknown[]): Document {
	const [type, ...args] = op as [string, ...any[]];
	if (type === 'set') {
		const [node_id, property] = args[0];
		const value = structuredClone(args[1]);
		return {
			...doc,
			nodes: {
				...doc.nodes,
				[node_id]: {
					...doc.nodes[node_id],
					[property]: value
				}
			}
		};
	} else if (type === 'create') {
		return {
			...doc,
			nodes: {
				...doc.nodes,
				[args[0].id]: structuredClone(args[0])
			}
		};
	} else if (type === 'delete') {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { [args[0]]: _removed, ...remaining_nodes } = doc.nodes;
		return {
			...doc,
			nodes: remaining_nodes
		};
	}
	return doc;
}

/** Count references to `node_id` from every other node in the doc. */
export function count_references(schema: DocumentSchema, doc: Document, node_id: NodeId): number {
	let count = 0;

	for (const node of Object.values(doc.nodes) as DocumentNode[]) {
		for (const [property, value] of Object.entries(node)) {
			if (property === 'id' || property === 'type') continue;

			const prop_type = property_type(schema, node.type, property);

			if (prop_type === 'node_array' && Array.isArray(value)) {
				count += value.filter((id) => id === node_id).length;
			} else if (prop_type === 'node' && value === node_id) {
				count += 1;
			}
		}
	}

	return count;
}

/**
 * Get the annotation overlapping the current selection, optionally
 * filtered by the annotation node's `type`. Overlap means: the
 * annotation contains the selection start, contains the selection
 * end, or is fully contained by the selection.
 */
export function get_active_annotation(
	schema: DocumentSchema,
	doc: Document,
	selection?: Selection | null,
	annotation_type?: string
): Annotation | null {
	if (selection?.type !== 'text') return null;
	const range = get_selection_range(selection);
	if (!range) return null;

	const annotated_text = get(schema, doc, selection.path);
	const annotations = annotated_text.annotations as Annotation[];

	const active_annotation =
		annotations.find(
			({ start_offset, end_offset }) =>
				(start_offset <= range.start_offset && end_offset > range.start_offset) ||
				(start_offset < range.end_offset && end_offset >= range.end_offset) ||
				(start_offset >= range.start_offset && end_offset <= range.end_offset)
		) || null;

	if (annotation_type && active_annotation) {
		const annotation_node = get(schema, doc, [active_annotation.node_id]);
		return annotation_node?.type === annotation_type ? active_annotation : null;
	} else {
		return active_annotation;
	}
}

/**
 * Same as `count_references` but ignores nodes flagged in
 * `nodes_to_delete`. Also counts annotation refs from
 * `annotated_text` fields, which the plain `count_references`
 * doesn't.
 */
export function count_references_excluding_deleted(
	schema: DocumentSchema,
	doc: Document,
	target_node_id: NodeId,
	nodes_to_delete: Record<NodeId, boolean>
): number {
	let count = 0;

	for (const node of Object.values(doc.nodes) as DocumentNode[]) {
		if (nodes_to_delete[node.id]) continue;

		for (const [property, value] of Object.entries(node)) {
			if (property === 'id' || property === 'type') continue;

			const prop_type = property_type(schema, node.type, property);

			if (prop_type === 'node_array' && Array.isArray(value)) {
				count += value.filter((id) => id === target_node_id).length;
			} else if (prop_type === 'node' && value === target_node_id) {
				count += 1;
			} else if (prop_type === 'annotated_text' && value && (value as any).annotations) {
				count += ((value as { annotations: Annotation[] }).annotations).filter(
					(annotation) => annotation.node_id === target_node_id
				).length;
			}
		}
	}

	return count;
}

/**
 * Validate a selection against the current document state. Works
 * with anything that exposes `get(path)` and `inspect(path)` — both
 * `Session` and `Transaction` qualify.
 */
export function validate_selection(
	selection: Selection | null | undefined,
	session_or_transaction: {
		get: (path: DocumentPath) => unknown;
		inspect: (path: DocumentPath) => unknown;
	}
): void {
	if (!selection) return;

	const selection_type = selection.type;
	if (!['node', 'text', 'property'].includes(selection_type)) {
		throw new Error(`Invalid selection type: ${selection_type}`);
	}

	if (selection_type === 'node') {
		const node_array = session_or_transaction.get(selection.path);

		if (!Array.isArray(node_array)) {
			throw new Error('Node selection path must point to a node_array');
		}

		const max_offset = node_array.length;
		if (selection.anchor_offset < 0 || selection.anchor_offset > max_offset) {
			throw new Error(
				`Node selection anchor_offset (${selection.anchor_offset}) is out of bounds. Max is ${max_offset}.`
			);
		}
		if (selection.focus_offset < 0 || selection.focus_offset > max_offset) {
			throw new Error(
				`Node selection focus_offset (${selection.focus_offset}) is out of bounds. Max is ${max_offset}.`
			);
		}
	} else if (selection_type === 'text') {
		const annotated_text = session_or_transaction.get(selection.path) as {
			text?: string;
		} | null;

		if (!annotated_text || typeof annotated_text.text !== 'string') {
			throw new Error('Text selection path must point to annotated_text');
		}

		const char_length = get_char_length(annotated_text.text);
		if (selection.anchor_offset < 0 || selection.anchor_offset > char_length) {
			throw new Error(
				`Text selection anchor_offset (${selection.anchor_offset}) is out of bounds. Max is ${char_length}.`
			);
		}
		if (selection.focus_offset < 0 || selection.focus_offset > char_length) {
			throw new Error(
				`Text selection focus_offset (${selection.focus_offset}) is out of bounds. Max is ${char_length}.`
			);
		}
	} else if (selection_type === 'property') {
		if (!session_or_transaction.inspect(selection.path)) {
			throw new Error(`Property selection path not found: ${selection.path.join('.')}`);
		}
	}
}
