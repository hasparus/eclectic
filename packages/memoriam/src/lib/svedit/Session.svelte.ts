import Transaction from './Transaction.svelte.js';
import { char_slice, traverse } from './utils.js';
import {
	get as doc_get,
	property_type as doc_property_type,
	kind as doc_kind,
	inspect as doc_inspect,
	apply_op,
	count_references as doc_count_references,
	validate_document_schema,
	validate_node,
	get_active_annotation,
	validate_selection
} from './doc_utils.js';
import type {
	NodeId,
	DocumentPath,
	Selection,
	Annotation,
	NodeKind,
	DocumentSchema,
	DocumentNode,
	Document,
	AnnotatedText
} from './types.d.ts';

const BATCH_WINDOW_MS = 1000; // 1 second

export interface SessionOptions {
	/** Initial selection state */
	selection?: Selection;
}

/**
 * `Automerge.splice`-shaped function. We pass it in rather than
 * importing Automerge so the editor stays usable without an
 * Automerge dependency.
 */
export type SpliceFn = (
	doc: unknown,
	path: Array<string | number>,
	index: number,
	deleteCount: number,
	value?: string
) => void;

/**
 * The narrow slice of an Automerge `DocHandle` Session reaches for.
 */
export interface AutomergeHandle {
	change: (fn: (d: AutomergeDoc) => void) => void;
	doc: () => AutomergeDoc | undefined;
	on: (event: 'change', fn: () => void) => void;
	off: (event: 'change', fn: () => void) => void;
}

interface AutomergeDoc {
	nodes?: Record<string, DocumentNode>;
	[key: string]: unknown;
}

interface HistoryEntry {
	ops: unknown[][];
	inverse_ops: unknown[][];
	selection_before: Selection | null;
	selection_after: Selection | null;
}

export interface SessionConfig {
	generate_id?: () => string;
	create_commands_and_keymap?: (context: unknown) => {
		commands: Record<string, unknown>;
		keymap: Record<string, unknown>;
	};
	inserters?: Record<string, (tr: Transaction, content?: AnnotatedText) => void>;
	// Open the type so app-level configs can hang arbitrary helpers
	// (node_layouts, system_components, html_exporters, etc.) without
	// each one needing to extend SessionConfig.
	[key: string]: any;
}

export default class Session {
	#selection = $state.raw<Selection | null>(null);

	schema = $state.raw<DocumentSchema>({} as DocumentSchema);
	doc = $state.raw<Document>({} as Document);
	config = $state.raw<SessionConfig>({});

	history = $state.raw<HistoryEntry[]>([]);
	history_index = $state.raw(-1);
	last_batch_started = $state.raw<number | undefined>(undefined);

	// Commands and keymap - initialized by Svedit when ready
	// NOTE: Assumes single Svedit instance per session
	commands = $state.raw<Record<string, unknown>>({});
	keymap = $state.raw<Record<string, unknown>>({});

	/**
	 * Automerge binding. When attached, every local `apply` mirrors
	 * its `ops` into the bound document via `handle.change(...)`;
	 * remote patches arriving on the same handle update `this.doc`
	 * with the materialised Automerge state.
	 *
	 * `#applying_remote` is the re-entry guard — the remote patch
	 * handler updates `this.doc` directly, which would otherwise
	 * trigger another local `apply` and echo back to Automerge.
	 *
	 * `#splice_fn` is `Automerge.splice` passed through from the
	 * caller. We don't import it directly here so the editor stays
	 * usable without an Automerge dependency loaded; the binding
	 * caller (which already imports Automerge for the handle)
	 * threads it in via `attach_automerge_handle`.
	 */
	#automerge_handle: AutomergeHandle | null = null;
	#applying_remote = false;
	#automerge_change_listener: (() => void) | null = null;
	#splice_fn: SpliceFn | null = null;
	// Set while a local mirror is in flight so the synchronous
	// `change` event emitted by `handle.change()` doesn't echo back
	// through `#on_automerge_change` and wholesale-overwrite
	// `this.doc.nodes`. Without this guard, each local keystroke
	// triggers a re-render of the entire contenteditable, and
	// rapid typing loses keystrokes mid-rerender.
	#mirroring_locally = false;

	// Reactive helpers for UI state
	can_undo = $derived(this.history_index >= 0);
	can_redo = $derived(this.history_index < this.history.length - 1);

	// Reactive variable for selected node
	selected_node = $derived(this.get_selected_node());
	available_annotation_types = $derived(this.get_available_annotation_types());

	constructor(
		schema: DocumentSchema,
		doc: Document,
		config: SessionConfig,
		options: SessionOptions = {}
	) {
		// Validate the schema first
		validate_document_schema(schema);

		this.schema = schema;
		this.doc = doc;
		this.config = config;

		// Set selection after doc is initialized so validation can work properly
		this.selection = options.selection ?? null;
	}

	get selection(): Selection | null {
		return this.#selection;
	}

	/**
	 * @throws {Error} Throws if the selection is invalid
	 */
	set selection(value: Selection | null) {
		this._validate_selection(value);
		this.#selection = value;
	}

	/**
	 * Validates that a selection is within bounds and refers to valid paths.
	 * @throws {Error} Throws if the selection is invalid
	 */
	private _validate_selection(selection: Selection | null): void {
		validate_selection(selection, this as unknown as Parameters<typeof validate_selection>[1]);
	}

	get document_id(): string {
		return this.doc.document_id;
	}

	validate_doc(): void {
		for (const node of Object.values(this.doc.nodes)) {
			validate_node(node, this.schema, this.doc.nodes);
		}
	}

	generate_id(): string {
		if (this.config?.generate_id) {
			return this.config.generate_id();
		} else {
			return crypto.randomUUID();
		}
	}

	/**
	 * Initialize commands and keymap for this session.
	 * Called by Svedit component when it has the necessary context.
	 *
	 * NOTE: This assumes a single Svedit instance per session.
	 * For multiple editors on the same document, this architecture would need
	 * to be refactored to support multiple sessions per document.
	 */
	initialize_commands(context: unknown): void {
		if (this.config?.create_commands_and_keymap) {
			const { commands, keymap } = this.config.create_commands_and_keymap(context);
			this.commands = commands;
			this.keymap = keymap;
		}
	}

	get_available_annotation_types(): string[] {
		if (this.selection?.type !== 'text') return [];
		const path = this.selection.path;
		const property_definition = this.inspect(path) as { node_types?: string[] };
		return property_definition.node_types || [];
	}

	// Helper function to get the currently selected node
	get_selected_node(): DocumentNode | null {
		if (!this.selection) return null;

		if (this.selection.type === 'node') {
			const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
			const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
			// Only consider selection of a single node
			if (end - start !== 1) return null;
			const node_array = this.get(this.selection.path) as string[];
			const node_id = node_array[start];
			return node_id ? (this.get(node_id) as DocumentNode) : null;
		} else {
			// we are assuming we are either in a text or property (=custom) selection
			const owner_node_path = this.selection?.path?.slice(0, -1);
			if (!owner_node_path || owner_node_path.length === 0) return null;
			const owner_node = this.get(owner_node_path) as DocumentNode | undefined;
			return owner_node ?? null;
		}
	}

	/**
	 * Creates a new transaction for making atomic changes to the document.
	 */
	get tr(): Transaction {
		// We create a copy of the current state to avoid modifying the original
		return new Transaction(this.schema, this.doc, this.selection, this.config);
	}

	/**
	 * Applies a transaction to the document.
	 * Auto-batches history entries with debounced behavior (max one entry per 2 seconds) when batch is true.
	 */
	apply(transaction: Transaction, { batch = false }: { batch?: boolean } = {}): this {
		this.doc = transaction.doc;
		// Make sure selection gets a new reference (is rerendered)
		this.selection = structuredClone(transaction.selection);

		// Mirror to the bound Automerge doc, if any. Skip when we're
		// inside a remote-patch application — otherwise we'd echo
		// the remote change back to peers and ping-pong forever.
		if (this.#automerge_handle && !this.#applying_remote) {
			this.#mirror_ops_to_automerge(transaction.ops);
		}

		if (this.history_index < this.history.length - 1) {
			this.history = this.history.slice(0, this.history_index + 1);
		}

		const now = Date.now();
		const should_batch =
			batch &&
			this.last_batch_started !== undefined &&
			now - this.last_batch_started < BATCH_WINDOW_MS;

		if (should_batch) {
			// Append to existing history entry (within 2s of batch start)
			const last_entry = this.history[this.history_index];
			last_entry.ops.push(...transaction.ops);
			last_entry.inverse_ops.push(...transaction.inverse_ops);
			last_entry.selection_after = this.selection;
			// Trigger update
			this.history = [...this.history];
		} else {
			// Create new history entry (more than 2s since batch started, or first edit, or batch not requested)
			this.history = [
				...this.history,
				{
					ops: transaction.ops,
					inverse_ops: transaction.inverse_ops,
					selection_before: transaction.selection_before,
					selection_after: this.selection
				}
			];
			this.history_index = this.history_index + 1;
			// Only set last_batch_started if batching was requested
			if (batch) {
				this.last_batch_started = now;
			} else {
				this.last_batch_started = undefined;
			}
		}

		return this;
	}

	undo(): this | undefined {
		if (this.history_index < 0) {
			return;
		}
		const change = this.history[this.history_index];
		let doc = this.doc;
		change.inverse_ops
			.slice()
			.reverse()
			.forEach((op) => {
				doc = apply_op(doc, op);
			});
		this.doc = doc;
		this.selection = change.selection_before;
		this.history_index = this.history_index - 1;
		return this;
	}

	redo(): this | undefined {
		if (this.history_index >= this.history.length - 1) {
			return;
		}
		this.history_index = this.history_index + 1;
		const change = this.history[this.history_index];
		let doc = this.doc;
		change.ops.forEach((op) => {
			doc = apply_op(doc, op);
		});
		this.doc = doc;
		this.selection = change.selection_after;
		return this;
	}

	/**
	 * Gets a node instance or property value at the specified path.
	 *
	 * @example
	 * // Get a node by ID
	 * session.get('list_1') // => { type: 'list', id: 'list_1', ... }
	 *
	 * @example
	 * // Get a node array property
	 * session.get(['list_1', 'list_items']) // => [ 'list_item_1', 'list_item_2' ]
	 *
	 * @example
	 * // Get a specific node from an array
	 * session.get(['page_1', 'body', 3, 'list_items', 0]) // => { type: 'list_item', id: 'list_item_1', ... }
	 *
	 * @example
	 * // Get an annotated text property
	 * session.get(['page_1', 'cover', 'title']) // => {text: 'Hello world', annotations: []}
	 */
	get(path: DocumentPath | string): any {
		return doc_get(this.schema, this.doc, path);
	}

	/**
	 * While .get gives you the value of a path, inspect gives you
	 * the type info of that value.
	 *
	 * @example
	 * session.inspect(['page_1', 'body']) => {
	 *   kind: 'property',
	 *   name: 'body',
	 *   type: 'node_array',
	 *   node_types: ['text', 'story', 'list'],
	 *   default_node_type: 'text'
	 * }
	 *
	 * @example
	 * session.inspect(['page_1', 'body', 1]) => {
	 *   kind: 'node',
	 *   id: 'paragraph_234',
	 *   type: 'paragraph',
	 *   properties: {...}
	 * }
	 */
	inspect(path: DocumentPath): { kind: 'property' | 'node'; [key: string]: unknown } {
		return doc_inspect(this.schema, this.doc, path) as {
			kind: 'property' | 'node';
			[key: string]: unknown;
		};
	}

	/**
	 * Determines the kind of a node ('block' for structured blocks, 'text' for pure
	 * text nodes or 'annotation' for annotation nodes.
	 */
	kind(node: DocumentNode): NodeKind {
		return doc_kind(this.schema, node);
	}

	/**
	 * Determines whether a node type can be inserted at a given selection.
	 */
	can_insert(node_type: string, selection: Selection | null = this.selection): boolean {
		if (selection?.type === 'node') {
			const property_definition = this.inspect(selection.path) as unknown as { node_types: string[] };
			if (property_definition.node_types.includes(node_type)) {
				return true;
			}
		}

		// No insert position found yet, and root not reached, try one level up if possible
		const next_node_insert_caret = this.get_next_node_insert_caret(selection);
		if (!next_node_insert_caret) return false;
		return this.can_insert(node_type, next_node_insert_caret);
	}

	/**
	 * Compute next possible insert position from a given selection
	 */
	get_next_node_insert_caret(selection: Selection | null = this.selection): Selection | null {
		// There's no parent path to insert into
		if (!selection || selection.path.length <= 2) {
			return null;
		}

		const node_offset = parseInt(String(selection.path.at(-2)), 10) + 1;
		return {
			type: 'node',
			path: selection.path.slice(0, -2),
			anchor_offset: node_offset,
			focus_offset: node_offset
		};
	}

	/**
	 * Returns the annotation object that is currently "under the cursor".
	 * NOTE: Annotations in Svedit are exclusive, so there can only be one active_annotation
	 */
	active_annotation(annotation_type?: string): Annotation | null {
		return get_active_annotation(this.schema, this.doc, this.selection, annotation_type);
	}

	get_selected_annotated_text(): {
		text: string;
		annotations: Annotation[];
		nodes: Record<string, DocumentNode>;
	} | null {
		if (this.selection?.type !== 'text') return null;

		const selection_start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
		const selection_end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
		const annotated_text = this.get(this.selection.path) as AnnotatedText;
		const text = char_slice(annotated_text.text, selection_start, selection_end);
		const nodes: Record<string, DocumentNode> = {};
		const annotations = annotated_text.annotations
			.map((a) => {
				if (selection_start < a.end_offset && selection_end > a.start_offset) {
					const sub_graph = this.traverse(a.node_id);
					for (const node of sub_graph) {
						if (!nodes[node.id]) {
							nodes[node.id] = node;
						}
					}
					return {
						start_offset: Math.max(a.start_offset - selection_start, 0),
						end_offset: Math.min(a.end_offset - selection_start, selection_end - selection_start),
						node_id: a.node_id
					};
				} else {
					return null;
				}
			})
			.filter((a): a is Annotation => a !== null);

		return { text, annotations, nodes };
	}

	// TODO: think about ways how we can also turn a node selection into plain text.
	get_selected_plain_text(): string | null {
		if (this.selection?.type !== 'text') return null;

		const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
		const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
		const annotated_text = this.get(this.selection.path) as AnnotatedText;
		return char_slice(annotated_text.text, start, end);
	}

	get_selected_nodes(): string[] | null {
		if (this.selection?.type !== 'node') return null;

		const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
		const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
		const node_array = this.get(this.selection.path) as string[];
		return $state.snapshot(node_array.slice(start, end)) as string[];
	}

	select_parent(): void {
		if (!this.selection) return;
		if (['text', 'property'].includes(this.selection?.type)) {
			// For text and property selections (e.g. ['page_1', 'body', 0, 'image']), we need to go up two levels
			// in the path
			if (this.selection.path.length > 3) {
				const parent_path = this.selection.path.slice(0, -2);
				const current_index = parseInt(
					String(this.selection.path[this.selection.path.length - 2])
				);
				this.selection = {
					type: 'node',
					path: parent_path,
					anchor_offset: current_index,
					focus_offset: current_index + 1
				};
			} else {
				this.selection = null;
			}
		} else if (this.selection.type === 'node') {
			// For node selections, we go up one level
			if (this.selection.path.length > 3) {
				const parent_path = this.selection.path.slice(0, -2);
				const current_index = parseInt(
					String(this.selection.path[this.selection.path.length - 2])
				);

				this.selection = {
					type: 'node',
					path: parent_path,
					anchor_offset: current_index,
					focus_offset: current_index + 1
				};
			} else {
				this.selection = null;
			}
		} else {
			this.selection = null;
		}
	}

	/**
	 * Traverses the document and returns a list of nodes in depth-first order.
	 *
	 * The traversal order is:
	 * 1. Leaf nodes first
	 * 2. Branch nodes second
	 * 3. Root node (entry point) last
	 *
	 * @note Nodes that are not reachable from the entry point node will not be included
	 */
	traverse(node_id: string): DocumentNode[] {
		return traverse(node_id, this.schema, $state.snapshot(this.doc.nodes));
	}

	/**
	 * Convert the document to a clean format for persistence.
	 *
	 * We make a traversal to ensure that orphaned nodes are not included,
	 * and that leaf nodes go first, followed by branches and the root node at last.
	 */
	to_json(): Document {
		// this will order the nodes (depth-first traversal)
		const nodes_array = this.traverse(this.document_id);
		// convert nodes array to object with node IDs as keys
		const nodes = Object.fromEntries(nodes_array.map((node) => [node.id, node]));
		return {
			document_id: this.document_id,
			nodes
		};
	}

	// property_type('page', 'body') => 'node_array'
	// property_type('paragraph', 'content') => 'annotated_text'
	property_type(type: string, property: string): string {
		return doc_property_type(this.schema, type, property);
	}

	// Count how many times a node is referenced in the document
	count_references(node_id: NodeId): number {
		return doc_count_references(this.schema, this.doc, node_id);
	}

	// Get all nodes referenced by a given node (recursively)
	get_referenced_nodes(node_id: NodeId): NodeId[] {
		const traversed_nodes = this.traverse(node_id);

		// Extract IDs and exclude the last element (root node)
		return traversed_nodes.slice(0, -1).map((node) => node.id);
	}

	// =============================================================
	// Automerge binding
	// =============================================================

	/**
	 * Attach an Automerge `DocHandle` to this session. Sync becomes
	 * bidirectional:
	 *   • local `apply()` mirrors the transaction's `ops` into the
	 *     handle via `change(d => ...)`. Text changes inside
	 *     `annotated_text` properties route through `splice_fn`
	 *     (Automerge's character-level CRDT op) so concurrent
	 *     typing in the same paragraph merges per-character
	 *     rather than last-write-wins.
	 *   • remote `change` events on the handle update `this.doc`
	 *     with the materialised Automerge state (guarded against
	 *     echoing back via `#applying_remote`).
	 *
	 * The handle's doc shape is `{ nodes: { id: node } }` — the
	 * same shape the local doc carries, minus svedit metadata
	 * like `document_id`. Bootstrapping the handle (writing the
	 * initial `nodes` map) is the caller's job.
	 *
	 * `splice_fn` is `Automerge.splice` (or equivalent). Optional;
	 * if omitted, text changes fall back to whole-value replace
	 * and lose per-character merge.
	 */
	attach_automerge_handle(handle: AutomergeHandle, splice_fn?: SpliceFn): void {
		this.detach_automerge_handle();
		this.#automerge_handle = handle;
		this.#splice_fn = splice_fn ?? null;
		const listener = () => this.#on_automerge_change();
		this.#automerge_change_listener = listener;
		handle.on('change', listener);
	}

	/**
	 * Tear down the Automerge subscription. Idempotent.
	 */
	detach_automerge_handle(): void {
		if (this.#automerge_handle && this.#automerge_change_listener) {
			this.#automerge_handle.off('change', this.#automerge_change_listener);
		}
		this.#automerge_handle = null;
		this.#automerge_change_listener = null;
	}

	/**
	 * Apply a list of svedit ops to the bound Automerge doc.
	 *
	 *   ['set', [node_id, property], value] →
	 *     plain map assignment, except when `value` looks like an
	 *     annotated_text (`{ text, annotations }`) AND the previous
	 *     value was one too — in which case we splice the text
	 *     character-by-character so concurrent typing in the same
	 *     paragraph merges per-character instead of last-write-wins.
	 *   ['create', node]                    → d.nodes[node.id] = node
	 *   ['delete', node_id]                 → delete d.nodes[node_id]
	 *
	 * Unknown op types are ignored — svedit may grow new ones
	 * upstream and we don't want to crash on them.
	 */
	#mirror_ops_to_automerge(ops: unknown[]): void {
		const handle = this.#automerge_handle;
		if (!handle || !ops || ops.length === 0) return;
		const splice_fn = this.#splice_fn;
		this.#mirroring_locally = true;
		const release = () => {
			this.#mirroring_locally = false;
		};
		// Cover both sync (EventEmitter) and microtask-deferred `change`
		// emits. The flag flips back at the end of this stack and at
		// the next microtask — whichever the handle uses, the echo is
		// already swallowed by then.
		queueMicrotask(release);
		try {
		handle.change((d: AutomergeDoc) => {
			if (!d.nodes) d.nodes = {};
			const nodes = d.nodes;
			for (const op of ops) {
				const [type, ...args] = op as [string, ...unknown[]];
				if (type === 'set') {
					const [node_id, property] = args[0] as [string, string];
					const new_value = args[1];
					const old_value = (nodes[node_id] as Record<string, unknown> | undefined)?.[property];
					if (!nodes[node_id]) {
						// Stub for a not-yet-created node — old shape was
						// `{ id }` only; the `create` op fills in `type`
						// and the rest. Don't synthesize a `type` here.
						nodes[node_id] = { id: node_id } as unknown as DocumentNode;
					}
					if (splice_fn && is_annotated_text(new_value) && is_annotated_text(old_value)) {
						// Per-character merge on `.text` — concurrent
						// typing in the same paragraph keeps both
						// users' keystrokes. The `annotations` array is
						// replaced wholesale; per-mark CRDT is the
						// next layer.
						apply_text_splice(
							splice_fn,
							d,
							['nodes', node_id, property, 'text'],
							old_value.text,
							new_value.text
						);
						(nodes[node_id][property] as AnnotatedText).annotations = structuredClone(
							new_value.annotations
						);
					} else {
						(nodes[node_id] as Record<string, unknown>)[property] = structuredClone(new_value);
					}
				} else if (type === 'create') {
					const node = structuredClone(args[0]) as DocumentNode;
					nodes[node.id] = node;
				} else if (type === 'delete') {
					const node_id = args[0] as string;
					delete nodes[node_id];
				}
			}
		});
		} finally {
			release();
		}
	}

	/**
	 * Re-materialise local `doc` from the bound Automerge handle.
	 * Called whenever the handle fires `change` — both for our own
	 * local mirror (skipped via `#mirroring_locally`) and remote
	 * peer updates.
	 */
	#on_automerge_change(): void {
		// Our own write echo — skip the wholesale node-map replace
		// so we don't re-render the contenteditable mid-keystroke.
		if (this.#mirroring_locally) return;
		const handle = this.#automerge_handle;
		if (!handle) return;
		const next = handle.doc();
		if (!next || !next.nodes) return;
		// Skip if the materialised nodes match what we already render
		// — saves a $state reassignment + downstream rerender on
		// every local echo.
		try {
			if (this.doc && this.doc.nodes && shallowEqualNodes(this.doc.nodes, next.nodes)) {
				return;
			}
		} catch {
			// fall through to update
		}
		this.#applying_remote = true;
		try {
			// Preserve everything `this.doc` carries that's NOT under
			// `nodes` (document_id, type, etc.) so consumers reading
			// those fields don't break.
			this.doc = { ...this.doc, nodes: structuredClone(next.nodes) };
		} finally {
			this.#applying_remote = false;
		}
	}
}

/**
 * Quick structural check for svedit's `annotated_text` shape —
 * `{ text: string, annotations: Annotation[] }`. We don't validate
 * Annotation fields; the mere shape is the discriminator.
 */
function is_annotated_text(v: unknown): v is AnnotatedText {
	return (
		v !== null &&
		typeof v === 'object' &&
		typeof (v as { text?: unknown }).text === 'string' &&
		Array.isArray((v as { annotations?: unknown }).annotations)
	);
}

/**
 * Translate a from-to text change into the smallest single
 * Automerge splice that produces it. Finds the common prefix and
 * suffix between `old_text` and `new_text`; the middle is what
 * actually changed, and we splice that range with the new content.
 *
 * Most editor operations (single-char insert / backspace / delete /
 * paste) collapse into one splice exactly; complex middle-substitutions
 * become one larger splice that still merges correctly with
 * concurrent edits elsewhere in the same string.
 */
function apply_text_splice(
	splice_fn: SpliceFn,
	doc: unknown,
	path: Array<string | number>,
	old_text: string,
	new_text: string
): void {
	if (old_text === new_text) return;
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
	if (deleteCount === 0 && insertText.length === 0) return;
	splice_fn(doc, path, prefix, deleteCount, insertText);
}

/**
 * Cheap structural equality for the node map. JSON.stringify is
 * fine here — node payloads are small JSON-friendly trees and
 * this only runs on Automerge `change` events. Wrapped in
 * try/catch by the caller; we don't worry about circular refs.
 */
function shallowEqualNodes(
	a: Record<string, unknown>,
	b: Record<string, unknown>
): boolean {
	const ak = Object.keys(a);
	const bk = Object.keys(b);
	if (ak.length !== bk.length) return false;
	for (const k of ak) {
		if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
	}
	return true;
}
