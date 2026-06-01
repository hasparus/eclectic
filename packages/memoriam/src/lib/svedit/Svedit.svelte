<script lang="ts">
	import { flushSync, getContext, setContext, type Component } from 'svelte';
	import {
		snake_to_pascal,
		get_char_length,
		utf16_to_char_offset,
		char_to_utf16_offset
	} from './utils.js';
	import { create_gap_computation } from './node_gap_computation.svelte.js';
	import DefaultNodeSelectionMarkers from './NodeSelectionMarkers.svelte';
	import './styles/svedit-colors.css';
	import type {
		SveditProps,
		Selection,
		TextSelection,
		NodeSelection,
		PropertySelection,
		NodeId,
		DocumentNode,
		AnnotatedText
	} from './types.d.ts';
	import type { KeyMapper } from './KeyMapper.svelte.js';

	let {
		session,
		editable = $bindable(false),
		path,
		class: css_class,
		autocapitalize = 'on',
		spellcheck = 'true'
	}: SveditProps = $props();

	let canvas_el: HTMLElement | undefined = $state();
	const root_node = $derived(session.get(path) as DocumentNode);
	const Overlays = $derived(
		(session.config as { system_components?: { Overlays?: Component } }).system_components?.Overlays
	);
	const NodeSelectionMarkers = $derived(
		(session.config as { system_components?: { NodeSelectionMarkers?: Component } })
			.system_components?.NodeSelectionMarkers ?? DefaultNodeSelectionMarkers
	);
	const RootComponent = $derived(
		(session.config as { node_components: Record<string, Component<Record<string, unknown>>> })
			.node_components[snake_to_pascal(root_node.type)]
	);

	let is_composing = $state(false);
	let canvas_focused = $state(false);
	let before_composition_selection: Selection | null = null;


	// let is_mobile = $derived(is_mobile_browser());
	// let is_chrome_desktop = $derived(is_chrome_desktop_browser());

	/** Expose function so parent can call it */
	export { focus_canvas };

	const context = {
		get session() {
			return session;
		},
		get editable() {
			return editable;
		},
		set editable(value) {
			editable = value;
		},
		get is_composing() {
			return is_composing;
		},
		get canvas_el() {
			return canvas_el;
		},
		get canvas_focused() {
			return canvas_focused;
		},
		focus_canvas
	};

	setContext('svedit', context);
	create_gap_computation(context as unknown as Parameters<typeof create_gap_computation>[0]);

	// Get KeyMapper from context (may be undefined if not provided)
	const key_mapper = getContext<KeyMapper | undefined>('key_mapper');

	// Initialize commands and keymap on the session
	$effect(() => {
		session.initialize_commands(context);
	});

	async function onbeforeinput(event: InputEvent): Promise<void> {
		// console.log(`onbeforeinput: ${event.inputType}, data: "${event.data}", isComposing: ${event.isComposing}`, event);

		if (event.inputType === 'historyUndo' && is_composing) {
			// Let the historyundo event pass through (when triggered from within oncompositionend)
			return;
		}

		// Sometimes the part that should be replaced is not the same as the current DOM selection
		// that's why we look into event.getTargetRanges()[0] if it exists.
		let target_selection: TextSelection | null | undefined;
		if (event.getTargetRanges?.()?.[0]) {
			target_selection = __get_text_selection_from_dom(
				event.getTargetRanges()[0] as unknown as Range
			);
		}

		// While composing, Svedit does nothing and lets the oncompositionend
		// event handle the final replacement.
		if (event.isComposing) {
			// NOTE: We only capture the initial selection right after the composition started
			// We're not interested in the target selections during the composition.
			if (!before_composition_selection) {
				before_composition_selection = target_selection ?? null;
			}
			return;
		}

		// NOTE: in cases we can't reliably map event.getTargetRanges()[0] to a session selection,
		// the original session.selection is used.
		if (target_selection) {
			session.selection = target_selection;
		}

		// Only take input when in a valid text selection inside the canvas
		if (!canvas_el?.contains(document.activeElement)) {
			event.preventDefault();
			return;
		}

		if (event.inputType === 'formatBold' && session.selection?.type === 'text') {
			session.apply(session.tr.annotate_text('strong'));
			event.preventDefault();
			event.stopPropagation();
		}

		if (event.inputType === 'formatItalic' && session.selection?.type === 'text') {
			session.apply(session.tr.annotate_text('emphasis'));
			event.preventDefault();
			event.stopPropagation();
		}

		// NOTE: underline doesn't make much sense as a semantic annotation,
		// so we rewire `cmd + u` to toggle highlights
		if (event.inputType === 'formatUnderline' && session.selection?.type === 'text') {
			session.apply(session.tr.annotate_text('highlight'));
			event.preventDefault();
			event.stopPropagation();
		}

		if (
			['deleteContentBackward', 'deleteWordBackward', 'deleteContent'].includes(event.inputType)
		) {
			delete_at_selection('backward');
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if (['deleteContentForward', 'deleteWordForward'].includes(event.inputType)) {
			delete_at_selection('forward');
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		// For now I reject drag+drop text movements.
		// TODO: If I want to support those, I need to handle them in such a way that
		// you can drag from one text property to another too.
		if (event.inputType === 'deleteByDrag' || event.inputType === 'insertFromDrop') {
			event.preventDefault();
			return;
		}

		// Insert the character, unless there is none.
		let inserted_text = event.data;

		// Sometimes (e.g. for replacements) the inserted_text is available via
		// event.dataTransfer, not event.data
		if (!inserted_text && event.dataTransfer) {
			inserted_text = event.dataTransfer?.getData('text/plain');
		}

		// Skip, if there's no inserted_text at all
		if (!inserted_text) {
			event.preventDefault();
			return;
		}

		const tr = session.tr;
		tr.insert_text(inserted_text);
		session.apply(tr, { batch: true });
		event.preventDefault();
	}

	/**
	 * Handles composition start events for input methods like dead keys
	 * This occurs when user starts typing a composed character (e.g., backtick for accents)
	 */
	function oncompositionstart(event: CompositionEvent): void {
		console.log('DEBUG: oncompositionstart', event.data);
		if (session.selection?.type !== 'text') {
			// Remove all ranges - completely clears the selection
			window.getSelection()?.removeAllRanges();

			// Restore
			setTimeout(() => {
				render_selection();
			}, 0);
			return;
		}

		// Disable keydown event handling during composition. This way, you can confirm
		// a diacritic (a->ä) with ENTER without causing a line break.
		if (key_mapper) key_mapper.skip_onkeydown = true;
		is_composing = true;
		return;
	}

	/**
	 * Handles composition end events for input methods like dead keys
	 * This occurs when composition is complete (e.g., after typing 'a' following backtick to get 'à')
	 */
	function oncompositionend(event: CompositionEvent): void {
		console.log('DEBUG: oncompositionend, insert:', event.data, event);
		if (!canvas_el?.contains(document.activeElement)) return;
		if (session.selection?.type === 'text') {
			// We need to remember the user's selection, as it might have changed in the process
			// of finishing a composition. For instance, the user might have selected a different
			// part of the text while composing.
			const user_selection = __get_selection_from_dom();

			// HACK: In order to restore the DOM state from before composition, we just run contenteditable's
			// native undo command. Then the DOM will be in sync again with the editor's internal state.
			document.execCommand('undo', false, undefined);

			// Set the selection to where the user initiated the composition, make changes, and apply.
			// NOTE: We need to check for valid selection here, as there is a rare race condition
			// where the user had no text selection at the start of composition.
			if (before_composition_selection) {
				session.selection = before_composition_selection;
				console.log('event.data', event.data);
				const tr = session.tr;
				tr.insert_text(event.data ?? '');
				session.apply(tr);
				// Recover user selection after composition. This assumes that document positions of natively
				// modified DOM (before transaction applied) are equal to the positions after the transaction.
				session.selection = user_selection;
			}

			// NOTE: We need a little timeout to nudge Safari into not handling the
			// ENTER press when confirming a diacritic
			setTimeout(() => {
				if (key_mapper) key_mapper.skip_onkeydown = false;
				is_composing = false;
			}, 100);
		}

		// Reset before_composition_selection, so we are ready for capturing the starting selection
		// of the next composition.
		before_composition_selection = null;
		return;
	}

	// Map DOM selection to internal model
	function onselectionchange(): void {
		if (!editable) return;
		if (!canvas_focused) return;
		const dom_selection = window.getSelection();
		if (!dom_selection || !dom_selection.rangeCount) return;

		// Only handle selection changes if selection is within the canvas
		const range = dom_selection.getRangeAt(0);
		if (!canvas_el?.contains(range.commonAncestorContainer)) return;
		const selection = __get_selection_from_dom();
		if (selection) {
			// Avoid assigning a new object reference when the selection is
			// structurally identical — prevents a redundant $effect cycle
			// (render_selection → scrollIntoView) on every DOM layout change.
			if (JSON.stringify(selection) === JSON.stringify(session.selection)) return;
			session.selection = selection;
		}
	}

	/**
	 * Creates HTML clipboard format with embedded svedit data
	 */
	function create_svedit_html_format(json_data: unknown, fallback_html: string): string {
		// Use encodeURIComponent to handle Unicode, then base64 encode
		const json_string = JSON.stringify(json_data);
		const encoded_data = btoa(encodeURIComponent(json_string));

		return `<meta charset="utf-8">
<div>
  <span data-svedit="${encoded_data}"></span>
</div>
${fallback_html}`;
	}

	/**
	 * Extracts svedit data from HTML clipboard format
	 */
	function extract_svedit_data_from_html(html: string): unknown {
		const svedit_regex = /data-svedit="([^"]+)"/;
		const match = html.match(svedit_regex);

		if (match && match[1]) {
			try {
				// Decode base64, then decode URI component to handle Unicode
				const base64_decoded = atob(match[1]);
				const decoded_data = decodeURIComponent(base64_decoded);
				return JSON.parse(decoded_data);
			} catch (e) {
				console.warn('Failed to decode svedit data from HTML:', e);
				return null;
			}
		}

		return null;
	}

	type SessionT = typeof session;
	type HtmlExporter = (
		node: DocumentNode,
		session: SessionT,
		html_exporters: Record<string, HtmlExporter>
	) => string;

	/**
	 * Default node exporter for nodes without specific exporters
	 */
	function default_node_html_exporter(
		node: DocumentNode,
		session_arg: SessionT,
		html_exporters: Record<string, HtmlExporter>
	): string {
		let html = '';
		const node_schema = session_arg.schema[node.type];

		for (const [prop_name, prop_value] of Object.entries(node)) {
			if (prop_name === 'id' || prop_name === 'type') continue;
			const property_definition = node_schema.properties[prop_name];
			// Check if this is an annotated_text property (object with text property)
			if (property_definition.type === 'annotated_text') {
				const text_content = (prop_value as AnnotatedText).text;
				if (text_content.trim()) {
					html += `<p>${text_content}</p>`;
				}
			} else if (property_definition.type === 'node_array') {
				for (const child_id of prop_value as string[]) {
					const child = session_arg.get(child_id) as DocumentNode;
					const child_exporter = html_exporters[child.type] || default_node_html_exporter;
					html += child_exporter(child, session_arg, html_exporters);
				}
			}
		}
		return html;
	}

	function default_node_plain_text_exporter(node: DocumentNode): string {
		let plain_text = '';

		for (const [prop_name, prop_value] of Object.entries(node)) {
			if (prop_name === 'id' || prop_name === 'type') continue;

			// Check if this is an annotated_text property (object with text property)
			if (
				typeof prop_value === 'object' &&
				prop_value !== null &&
				typeof (prop_value as { text?: unknown }).text === 'string'
			) {
				const text_content = (prop_value as AnnotatedText).text;
				if (text_content.trim()) {
					plain_text += `${text_content.trim()}\n\n`;
				}
			}
		}

		return plain_text;
	}

	/**
	 * Exports nodes to HTML using document config exporters
	 */
	function export_html(nodes: DocumentNode[]): string {
		let html = '';

		for (const node of nodes) {
			const html_exporters =
				((session.config as { html_exporters?: Record<string, HtmlExporter> }).html_exporters) ||
				{};

			if (html_exporters[node.type]) {
				// Use custom exporter for this node type
				html += html_exporters[node.type](node, session, html_exporters);
			} else {
				// Use default exporter
				html += default_node_html_exporter(node, session, html_exporters);
			}
		}
		return html;
	}

	function export_plain_text(nodes: DocumentNode[]): string {
		let plain_text = '';

		for (const node of nodes) {
			plain_text += default_node_plain_text_exporter(node);
		}
		return plain_text.trim();
	}

	function prepare_copy_payload(selected_node_ids: NodeId[]): {
		nodes: Record<string, DocumentNode>;
		main_nodes: NodeId[];
	} {
		const nodes: Record<string, DocumentNode> = {};

		// Get subgraph for each selected node using session.traverse()
		for (const node_id of selected_node_ids) {
			const subgraph = session.traverse(node_id);

			// Add all nodes from this subgraph to our nodes collection
			for (const node of subgraph) {
				if (!nodes[node.id]) {
					nodes[node.id] = node;
				}
			}
		}

		// Keep original IDs - we'll generate new ones during paste
		return { nodes, main_nodes: selected_node_ids };
	}

	function oncopy(event: ClipboardEvent, delete_selection = false): void {
		// Only handle copy events if editable and focus is within the canvas
		if (!editable) return;
		if (!canvas_el?.contains(document.activeElement)) return;

		event.preventDefault();
		event.stopPropagation();

		let plain_text: string | null | undefined;
		let html: string | undefined;
		let annotated_text: { text: string; annotations: unknown[]; nodes: unknown } | null;

		if (session.selection?.type === 'text') {
			plain_text = session.get_selected_plain_text();
			annotated_text = session.get_selected_annotated_text();
			const fallback_html = `<span>${annotated_text?.text ?? ''}</span>`;

			console.log('Text copy:', {
				annotated_text,
				plain_text,
				html
			});

			html = create_svedit_html_format(annotated_text, fallback_html);
		} else if (session.selection?.type === 'node') {
			const selected_nodes = session.get_selected_nodes() ?? [];
			const { nodes, main_nodes } = prepare_copy_payload(selected_nodes);

			const json_data = { nodes, main_nodes };

			console.log('Node copy:', {
				selected_nodes,
				nodes,
				total_nodes: Object.keys(nodes).length,
				operation: delete_selection ? 'cut' : 'copy'
			});

			// Generate fallback HTML for cross-app compatibility
			const selected_node_objects = main_nodes.map((id) => nodes[id]);
			const fallback_html = export_html(selected_node_objects);

			// Create HTML with embedded svedit data
			html = create_svedit_html_format(json_data, fallback_html);
			// Generate plain text representation
			plain_text = export_plain_text(selected_node_objects);
		} else if (session.selection?.type === 'property') {
			const property_definition = session.inspect(session.selection.path) as {
				name?: string;
				type?: string;
			};
			const value = session.get(session.selection.path);
			const json_data = {
				kind: 'property',
				name: property_definition.name,
				type: property_definition.type,
				value
			};
			console.log('Property copy:', json_data);
			html = create_svedit_html_format(json_data, `<span>${value}</span>`);
			plain_text = String(value);
		}

		// Write to clipboard using event.clipboardData
		try {
			event.clipboardData?.setData('text/plain', plain_text || '');
			event.clipboardData?.setData('text/html', html || '');
			console.log('Data copied to clipboard successfully');
		} catch (err) {
			console.error('Failed to copy data: ', err);
		}

		if (delete_selection) {
			delete_at_selection();
		}
	}

	/**
	 * Shared delete logic for cut, backspace, and forward-delete.
	 * For property selections, delegates to the config's handle_property_deletion hook.
	 * For text/node selections, uses the standard transaction delete_selection.
	 */
	function delete_at_selection(direction: 'backward' | 'forward' = 'backward'): void {
		if (session.selection?.type === 'property') {
			const handler = (
				session.config as {
					handle_property_deletion?: (s: SessionT, p: unknown) => void;
				}
			).handle_property_deletion;
			if (handler) {
				handler(session, session.selection.path);
			}
		} else {
			session.apply(session.tr.delete_selection(direction));
		}
	}

	function oncut(event: ClipboardEvent): void {
		if (!editable) return;
		oncopy(event, true);
	}

	interface NodePastePayload {
		nodes: Record<string, DocumentNode>;
		main_nodes: NodeId[];
		kind?: string;
		type?: string;
		value?: unknown;
		text?: string;
		annotations?: unknown[];
	}

	/**
	 * Attempts to paste JSON data as a node at the current selection.
	 */
	function try_node_paste(pasted_json: NodePastePayload, selection?: Selection | null): boolean {
		const { nodes, main_nodes } = pasted_json;

		// NOTE: At this point, nodes contains a subgraph from the copy
		// with original ids.
		const tr = session.tr;
		if (selection) {
			tr.set_selection(selection);
		}

		// We can safely assume we're dealing with a node_array property
		const property_definition = session.inspect(tr.selection!.path) as unknown as {
			node_types: string[];
		};
		const first_compatible_text_node_type = property_definition.node_types.find(
			(type) => session.kind({ type } as DocumentNode) === 'text'
		);

		const nodes_to_insert: NodeId[] = [];
		let rejected = false;
		for (const node_id of main_nodes) {
			const node = nodes[node_id];
			if (!property_definition.node_types.includes(node.type)) {
				// Incompatible node type detected
				if (session.kind(node) === 'text' && first_compatible_text_node_type) {
					const new_node_id = tr.build('the_node', {
						the_node: {
							id: 'the_node',
							type: first_compatible_text_node_type,
							content: node.content
						} as DocumentNode
					});
					nodes_to_insert.push(new_node_id);
				} else {
					console.log(
						`rejected ${node.type}. Only ${property_definition.node_types.join(', ')} allowed.`
					);
					rejected = true;
					break;
				}
			} else {
				const new_node_id = tr.build(node_id, nodes);
				nodes_to_insert.push(new_node_id);
			}
		}

		if (!rejected) {
			tr.insert_nodes(nodes_to_insert);
			session.apply(tr);
			return true;
		} else {
			if (tr.selection && tr.selection.path.length >= 2) {
				const next_node_insert_caret = session.get_next_node_insert_caret(tr.selection);
				if (next_node_insert_caret) {
					try_node_paste(pasted_json, next_node_insert_caret);
				}
			}
		}
		return false;
	}

	async function onpaste(event: ClipboardEvent): Promise<void> {
		// Only handle paste events if editable and focus is within the canvas
		if (!editable) return;
		if (!canvas_el?.contains(document.activeElement)) return;
		event.preventDefault();

		let plain_text: string | undefined;
		let pasted_json: NodePastePayload | undefined;
		const pasted_media: Array<{
			blob: File;
			data_url: string;
			type: string;
			size: number;
		}> = [];

		// NOTE: For some reason, await navigator.clipboard.read()
		const clipboard_items = event.clipboardData?.items;
		for (const item of clipboard_items || []) {
			if (
				item.type.startsWith('image/') ||
				item.type.startsWith('video/') ||
				item.type.startsWith('audio/')
			) {
				const blob = item.getAsFile();
				if (!blob) continue;
				const data_url = URL.createObjectURL(blob);
				pasted_media.push({
					blob,
					data_url,
					type: item.type,
					size: blob.size
				});
			}
		}

		if (pasted_media.length > 0) {
			const cfg = session.config as {
				handle_media_paste?: (s: SessionT, m: typeof pasted_media) => Promise<NodePastePayload | undefined>;
				handle_image_paste?: (s: SessionT, m: typeof pasted_media) => Promise<NodePastePayload | undefined>;
			};
			const handle_media_paste = cfg.handle_media_paste || cfg.handle_image_paste;
			pasted_json = handle_media_paste ? await handle_media_paste(session, pasted_media) : undefined;
			console.log('pasted_json_after_media_paste', pasted_json);
			// NOTE: If no pasted_json is returned from the custom handler, we assume that content creation has been
			// handled inside handle_media_paste already.
			if (!pasted_json) return;
		} else {
			// First try to extract svedit data from HTML format
			try {
				const html_content = event.clipboardData?.getData('text/html');
				if (html_content) {
					pasted_json = extract_svedit_data_from_html(html_content) as NodePastePayload | undefined;
				}
			} catch (e) {
				console.log('No HTML format available or failed to extract svedit data:', e);
				pasted_json = undefined;
			}

			try {
				plain_text = event.clipboardData?.getData('text/plain');
			} catch (e) {
				console.error('Failed to paste any content:', e);
			}

			// Try to contruct a node payload from plain text when applicable
			if (!pasted_json && typeof plain_text === 'string') {
				const plain_text_fragments = plain_text
					.split('\n\n')
					.map((fragment) => fragment.trim())
					.filter(Boolean);
				if (plain_text_fragments.length > 1) {
					pasted_json = {
						main_nodes: [],
						nodes: {}
					};
					for (let i = 0; i < plain_text_fragments.length; i++) {
						const fragment = plain_text_fragments[i];
						pasted_json.nodes['fragment_' + i] = {
							id: 'fragment_' + i,
							type: 'text',
							content: {
								text: fragment,
								annotations: []
							}
						};
						pasted_json.main_nodes.push('fragment_' + i);
					}
				}
			}
		}

		// console.log('plain_text', plain_text);
		// console.log('pasted_json', pasted_json);

		if (pasted_json?.main_nodes && session.selection?.type === 'node') {
			// Paste nodes at a node selection
			try_node_paste(pasted_json);
		} else if (pasted_json?.kind === 'property' && session.selection?.type === 'property') {
			const property_definition = session.inspect(session.selection.path);
			if (property_definition.type === pasted_json.type) {
				if (property_definition.type === 'node') {
					const tr = session.tr;
					const new_id = tr.build('some_new_node_id', {
						some_new_node_id: {
							...(pasted_json.value as Record<string, unknown>),
							id: 'some_new_node_id'
						} as DocumentNode
					});
					tr.set(session.selection.path, new_id);
					session.apply(tr);
				} else {
					// we assume that we have a value type for the property (string, number)
					session.apply(session.tr.set(session.selection.path, pasted_json.value));
				}
			}
		} else if (session.selection?.type === 'text' && pasted_json?.text) {
			// Paste text at a text selection
			session.apply(
				session.tr.insert_text(
					pasted_json.text,
					pasted_json.annotations as never,
					pasted_json.nodes
				)
			);
		} else if (
			session.selection?.type === 'text' &&
			pasted_json?.main_nodes?.length === 1 &&
			session.kind(pasted_json.nodes[pasted_json.main_nodes[0]]) === 'text'
		) {
			// Paste a single text node, at a text caret
			const text_property = pasted_json.nodes[pasted_json.main_nodes[0]].content as AnnotatedText;
			session.apply(
				session.tr.insert_text(text_property.text, text_property.annotations, pasted_json.nodes)
			);
		} else if (
			session.selection &&
			['text', 'property'].includes(session.selection.type) &&
			pasted_json?.nodes
		) {
			// Paste nodes at a text or property selection by finding the next valid insert caret
			const next_node_insert_caret = session.get_next_node_insert_caret(session.selection);
			try_node_paste(pasted_json, next_node_insert_caret);
		} else if (typeof plain_text === 'string') {
			// External paste: Fallback to plain text when no svedit data is found
			session.apply(session.tr.insert_text(plain_text.trim()));
		} else {
			console.log('Could not paste.');
		}
	}

	function render_selection(): void {
		const selection = session.selection;

		if (!selection) {
			// No model selection -> just leave things as they are
			const dom_selection = window.getSelection();
			dom_selection?.removeAllRanges();
			return;
		}

		// NOTE: Skip rerender only when the selection is the same and the focus is already within the canvas
		const prev_selection =
			__get_property_selection_from_dom() ||
			__get_text_selection_from_dom() ||
			__get_node_selection_from_dom();
		if (
			JSON.stringify(selection) === JSON.stringify(prev_selection) &&
			canvas_el?.contains(document.activeElement)
		) {
			// Skip. No need to rerender.
			return;
		}

		if (selection?.type === 'text') {
			__render_text_selection();
		} else if (selection?.type === 'node') {
			__render_node_selection();
		} else if (selection?.type === 'property') {
			__render_property_selection();
		} else {
			console.log('unsupported selection', $state.snapshot(selection));
		}
	}

	// Handle focus - push session's keymap onto stack
	function handle_canvas_focus() {
		// Use flushSync so highlight spans are removed from the DOM
		// immediately, before the browser processes the click's selection.
		flushSync(() => {
			// Clear the model selection so render_selection() does not call
			// setBaseAndExtent() with the old position, which would battle
			// with the new selection the user is making (the click/drag that
			// triggered this focus). The browser will place the caret and
			// fire selectionchange, which sets the model selection correctly.
			session.selection = null;
			canvas_focused = true;
		});
		key_mapper?.push_scope(session.keymap as Parameters<KeyMapper['push_scope']>[0]);
	}

	// Handle blur - pop document's keymap from stack
	function handle_canvas_blur() {
		// Use flushSync so the selection highlight span (with its CSS anchor)
		// is in the DOM immediately, before any popover/dialog tries to
		// position itself.
		flushSync(() => {
			canvas_focused = false;
		});
		key_mapper?.pop_scope();
	}

	function focus_canvas() {
		// Use flushSync so highlight spans are removed from the DOM
		// immediately, before we focus and render_selection walks the
		// text nodes.
		flushSync(() => {
			canvas_focused = true;
		});
		canvas_el?.focus();
	}

	/**
	 * When a DOM selection endpoint lands in a sibling NodeGap (not inside
	 * a node), resolves the adjacent node element for the walk-up algorithm.
	 */
	function __resolve_node_from_gap(el: HTMLElement): HTMLElement | null {
		const gap = el.closest('[data-gap-array-path]') as HTMLElement | null;
		if (!gap) return null;
		const array_path = gap.dataset.gapArrayPath;
		const offset = parseInt(gap.dataset.gapOffset ?? '0', 10);
		const node_idx = offset > 0 ? offset - 1 : 0;
		return (
			canvas_el?.querySelector<HTMLElement>(
				`[data-path="${array_path}.${node_idx}"][data-type="node"]`
			) ?? null
		);
	}

	/**
	 * Extracts a NodeSelection from the current DOM selection.
	 */
	function __get_node_selection_from_dom(): NodeSelection | null {
		const dom_selection = window.getSelection();
		if (!dom_selection || dom_selection.rangeCount === 0) return null;

		let focus_node = dom_selection.focusNode as HTMLElement | null;
		let anchor_node = dom_selection.anchorNode as HTMLElement | null;
		if (!focus_node || !anchor_node) return null;

		// If focus_node or anchor_node not an element node (e.g. a text node), we need
		// to use the parent element, so we can perform the closest() query on it.
		if (focus_node.nodeType !== Node.ELEMENT_NODE)
			focus_node = focus_node.parentElement as HTMLElement | null;
		if (anchor_node.nodeType !== Node.ELEMENT_NODE)
			anchor_node = anchor_node.parentElement as HTMLElement | null;
		if (!focus_node || !anchor_node) return null;

		// EDGE CASE: Collapsed selection inside a node gap (gap-after or gap-before).
		// Gaps are siblings of nodes with data-gap-array-path and data-gap-offset.
		const gap_el = focus_node.closest('[data-gap-array-path]') as HTMLElement | null;
		if (gap_el && focus_node === anchor_node) {
			const array_path = (gap_el.dataset.gapArrayPath ?? '').split('.');
			const gap_offset = parseInt(gap_el.dataset.gapOffset ?? '0', 10);
			return {
				type: 'node',
				path: array_path,
				anchor_offset: gap_offset,
				focus_offset: gap_offset
			};
		}

		let focus_root: HTMLElement | null =
			__resolve_node_from_gap(focus_node) ??
			(focus_node.closest('[data-path][data-type="node"]') as HTMLElement | null);
		if (!focus_root) return null;

		let anchor_root: HTMLElement | null =
			__resolve_node_from_gap(anchor_node) ??
			(anchor_node.closest('[data-path][data-type="node"]') as HTMLElement | null);
		if (!anchor_root) return null;

		let focus_root_path = (focus_root.dataset.path ?? '').split('.');
		let anchor_root_path = (anchor_root.dataset.path ?? '').split('.');
		let focus_node_depth = focus_root_path.length;
		let anchor_node_depth = anchor_root_path.length;

		// Walk both endpoints up the DOM until they share the same parent node_array.
		// This handles selections that span across arbitrarily nested node arrays by
		// finding the lowest common ancestor node_array and projecting each endpoint
		// onto its index within that array.
		let focus_walked_up = false;
		let anchor_walked_up = false;
		while (
			focus_root_path.slice(0, -1).join('.') !== anchor_root_path.slice(0, -1).join('.')
		) {
			if (focus_root_path.length > anchor_root_path.length) {
				// Focus is deeper — walk it up
				focus_root = (focus_root.parentElement?.closest('[data-path][data-type="node"]') ??
					null) as HTMLElement | null;
				if (!focus_root) return null;
				focus_root_path = (focus_root.dataset.path ?? '').split('.');
				focus_walked_up = true;
			} else if (anchor_root_path.length > focus_root_path.length) {
				// Anchor is deeper — walk it up
				anchor_root = (anchor_root.parentElement?.closest('[data-path][data-type="node"]') ??
					null) as HTMLElement | null;
				if (!anchor_root) return null;
				anchor_root_path = (anchor_root.dataset.path ?? '').split('.');
				anchor_walked_up = true;
			} else {
				// Same depth but different node arrays — walk both up
				focus_root = (focus_root.parentElement?.closest('[data-path][data-type="node"]') ??
					null) as HTMLElement | null;
				if (!focus_root) return null;
				focus_root_path = (focus_root.dataset.path ?? '').split('.');
				focus_walked_up = true;
				anchor_root = (anchor_root.parentElement?.closest('[data-path][data-type="node"]') ??
					null) as HTMLElement | null;
				if (!anchor_root) return null;
				anchor_root_path = (anchor_root.dataset.path ?? '').split('.');
				anchor_walked_up = true;
			}
		}

		// If both paths walked up to the root node, there's no common parent node_array
		// (e.g. selecting between nav and page body). The resulting path would be empty.
		if (anchor_root_path.length <= 1) return null;

		const parent_array_path = anchor_root_path.slice(0, -1);
		// A node selection is only valid inside a node_array property.
		const parent_property = session.inspect(parent_array_path);
		if (!parent_property || parent_property.type !== 'node_array') return null;

		let anchor_offset = parseInt(anchor_root_path.at(-1) ?? '0', 10);
		let focus_offset = parseInt(focus_root_path.at(-1) ?? '0', 10);

		// Check if it's a backwards selection
		const is_backwards = __is_dom_selection_backwards();
		if (is_backwards) {
			anchor_offset += 1;
		} else {
			focus_offset += 1;
		}

		// EDGE CASE: Exclude first node when anchor_node is a gap-after
		// in a non-collapsed forward selection.
		// Only apply when anchor wasn't walked up — if it was, the gap is at a
		// deeper nesting level and no longer relevant to the resolved node array.
		if (
			!anchor_walked_up &&
			anchor_node.parentElement?.dataset.type === 'gap-after' &&
			!is_backwards &&
			anchor_offset !== focus_offset
		) {
			anchor_offset += 1;
		}
		// EDGE CASE: Exclude first node when focus_node is a gap-after
		// in a non-collapsed backward selection.
		// Only apply when focus wasn't walked up — same reasoning as above.
		else if (
			!focus_walked_up &&
			focus_node.parentElement?.dataset.type === 'gap-after' &&
			is_backwards &&
			anchor_offset !== focus_offset &&
			// EDGE CASE: Only do correction when drag started from a deeper or equally deep anchor node
			anchor_node_depth >= focus_node_depth
		) {
			focus_offset += 1;
		}

		return {
			type: 'node',
			path: parent_array_path,
			anchor_offset: anchor_offset,
			focus_offset: focus_offset
		};
	}

	/**
	 * Extracts a PropertySelection from the current DOM selection.
	 */
	function __get_property_selection_from_dom(): PropertySelection | null {
		const dom_selection = window.getSelection();
		if (!dom_selection || dom_selection.rangeCount === 0) return null;

		const focus_root = dom_selection.focusNode?.parentElement?.closest(
			'[data-path][data-type="property"]'
		) as HTMLElement | null;
		if (!focus_root) return null;
		const anchor_root = dom_selection.anchorNode?.parentElement?.closest(
			'[data-path][data-type="property"]'
		) as HTMLElement | null;
		if (!anchor_root) return null;

		if (focus_root === anchor_root) {
			return {
				type: 'property',
				path: (focus_root.dataset.path ?? '').split('.')
			};
		}
		return null;
	}

	function __get_selection_from_dom(): Selection | null {
		return (
			__get_property_selection_from_dom() ||
			__get_text_selection_from_dom() ||
			__get_node_selection_from_dom()
		);
	}

	/**
	 * Extracts a TextSelection from the current DOM selection.
	 */
	function __get_text_selection_from_dom(range: Range | null = null): TextSelection | null {
		let dom_selection: globalThis.Selection | null = null;
		let focus_node: Node | null;
		let anchor_node: Node | null;
		let focus_offset_in_node: number; // anchor_offset_in_node;

		if (range) {
			// When range is provided, use it directly
			focus_node = range.endContainer;
			anchor_node = range.startContainer;
			focus_offset_in_node = range.endOffset;
			// anchor_offset_in_node = range.startOffset;
		} else {
			// Otherwise get from window selection
			dom_selection = window.getSelection();
			if (!dom_selection || dom_selection.rangeCount === 0) return null;
			focus_node = dom_selection.focusNode;
			anchor_node = dom_selection.anchorNode;
			focus_offset_in_node = dom_selection.focusOffset;
			// anchor_offset_in_node = dom_selection.anchorOffset;
			range = dom_selection.getRangeAt(0);
		}
		if (!focus_node || !anchor_node) return null;

		let focus_root: HTMLElement | null;
		let anchor_root: HTMLElement | null;

		if (
			focus_node === anchor_node &&
			(focus_node as HTMLElement).dataset?.type === 'text'
		) {
			// EDGE CASE 1: Either text node is empty (only a <br> is present), or caret is after a <br> at the very end of the text node
			focus_root = anchor_root = focus_node as HTMLElement;
		} else {
			focus_root = (focus_node.parentElement?.closest('[data-path][data-type="text"]') ??
				null) as HTMLElement | null;
			if (!focus_root) return null;
			anchor_root = (anchor_node.parentElement?.closest('[data-path][data-type="text"]') ??
				null) as HTMLElement | null;
			if (!anchor_root) return null;
		}

		if (focus_root !== anchor_root) {
			return null;
		}

		const path = (focus_root.dataset.path ?? '').split('.');

		if (!path) return null;

		// EDGE CASE 1B: Caret after trailing <br> at end of text
		//
		// AnnotatedTextProperty renders a trailing <br> for non-empty or non-focused text.
		// When the user places their caret after this <br>, focusNode is the container
		// element (not a text node), and normal processing would return position 0.
		// We detect this and return text_length instead.
		const text_content = (session.get(path) as AnnotatedText).text;
		const text_length = get_char_length(text_content);
		const child_nodes = focus_root.childNodes;

		if (
			focus_node === anchor_node &&
			focus_node === focus_root &&
			focus_root.dataset?.type === 'text' &&
			!focus_root.classList.contains('empty')
		) {
			// Find the last non-comment child node (comments are inserted by Svelte)
			let last_element_index = child_nodes.length - 1;
			while (last_element_index >= 0 && child_nodes[last_element_index].nodeType === Node.COMMENT_NODE) {
				last_element_index--;
			}

			// Check if caret is at or after the trailing <br>
			if (
				last_element_index >= 0 &&
				child_nodes[last_element_index].nodeName === 'BR' &&
				focus_offset_in_node >= last_element_index
			) {
				return {
					type: 'text',
					path,
					anchor_offset: text_length,
					focus_offset: text_length
				};
			}
		}

		let start_offset = 0;
		let end_offset = 0;
		let current_offset = 0;

		function processNode(node: Node): boolean {
			if (node.nodeType === Node.TEXT_NODE) {
				const nodeText = node.textContent ?? '';
				const nodeCharLength = get_char_length(nodeText);
				if (node === range!.startContainer) {
					// Convert UTF-16 offset to character offset
					const char_start_offset = utf16_to_char_offset(nodeText, range!.startOffset);
					start_offset = current_offset + char_start_offset;
				}
				if (node === range!.endContainer) {
					// Convert UTF-16 offset to character offset
					const char_end_offset = utf16_to_char_offset(nodeText, range!.endOffset);
					end_offset = current_offset + char_end_offset;
				}
				current_offset += nodeCharLength;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				for (const childNode of node.childNodes) {
					processNode(childNode);
				}
			}
			return end_offset !== 0;
		}

		// Process nodes to find offsets
		for (const childNode of focus_root.childNodes) {
			if (processNode(childNode)) break;
		}

		// Check if it's a backward selection
		// When range is provided, we can't detect backward selection from the range alone
		// since ranges are always normalized (start before end)
		const is_backward = dom_selection ? __is_dom_selection_backwards() : false;

		// Assign to anchor/focus based on direction
		const anchor_offset = is_backward ? end_offset : start_offset;
		const focus_offset = is_backward ? start_offset : end_offset;

		return {
			type: 'text',
			path,
			anchor_offset,
			focus_offset
		};
	}

	function __get_node_element(node_array_path: string, node_offset: number): HTMLElement | null {
		return (
			canvas_el?.querySelector<HTMLElement>(
				`[data-path="${node_array_path}.${node_offset}"][data-type="node"]`
			) ?? null
		);
	}

	function __render_node_selection(): void {
		const selection = session.selection as NodeSelection;
		const node_array_path = selection.path.join('.');
		const is_collapsed = selection.anchor_offset === selection.focus_offset;
		const is_backward = !is_collapsed && selection.anchor_offset > selection.focus_offset;

		const node_array_el = canvas_el?.querySelector(
			`[data-path="${node_array_path}"][data-type="node_array"]`
		);
		if (!node_array_el) return;

		const dom_selection = window.getSelection();
		if (!dom_selection) return;
		const range = window.document.createRange();

		const gap_selector = (offset: number) =>
			`[data-gap-array-path="${node_array_path}"][data-gap-offset="${offset}"]`;

		if (is_collapsed) {
			const gap_el = node_array_el.querySelector(gap_selector(selection.anchor_offset));
			if (!gap_el) return;
			// Target .svedit-selectable (has a box), not gap_el which is
			// display:contents and would cause the browser to normalize
			// the range into the parent, breaking read-back.
			const selectable = gap_el.querySelector('.svedit-selectable');
			if (!selectable) return;
			range.setStart(selectable, 1);
			range.setEnd(selectable, 1);
			dom_selection.removeAllRanges();
			dom_selection.addRange(range);
		} else {
			const anchor_gap = node_array_el.querySelector(gap_selector(selection.anchor_offset));
			const focus_gap = node_array_el.querySelector(gap_selector(selection.focus_offset));
			if (!anchor_gap || !focus_gap) return;
			const anchor_sel = anchor_gap.querySelector('.svedit-selectable');
			const focus_sel = focus_gap.querySelector('.svedit-selectable');
			if (!anchor_sel || !focus_sel) return;

			if (is_backward) {
				dom_selection.removeAllRanges();
				dom_selection.setBaseAndExtent(anchor_sel, 1, focus_sel, 1);
			} else {
				range.setStart(anchor_sel, 1);
				range.setEnd(focus_sel, 1);
				dom_selection.removeAllRanges();
				dom_selection.addRange(range);
			}
		}

		(node_array_el as HTMLElement).focus();
		const scroll_node_offset = is_collapsed
			? Math.max(0, selection.anchor_offset - 1)
			: is_backward
				? selection.focus_offset
				: selection.anchor_offset;
		const scroll_node = __get_node_element(node_array_path, scroll_node_offset);
		if (scroll_node) {
			setTimeout(() => {
				scroll_node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}, 0);
		}
	}

	function __render_property_selection(): void {
		const selection = session.selection as PropertySelection;
		// The element that holds the property
		const el = canvas_el?.querySelector(
			`[data-path="${selection.path.join('.')}"][data-type="property"]`
		);
		const gap_selectable = el?.querySelector('.svedit-selectable');
		if (!gap_selectable) return;
		const range = window.document.createRange();
		const dom_selection = window.getSelection();
		if (!dom_selection) return;

		// Select the entire gap element contents and collapse to start
		range.selectNodeContents(gap_selectable);
		range.collapse(true); // Collapse to start position
		dom_selection.removeAllRanges();
		dom_selection.addRange(range);

		// Scroll the selection into view
		setTimeout(() => {
			const selectedElement = dom_selection.focusNode?.parentElement;
			if (selectedElement) {
				selectedElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		}, 0);
	}

	function __render_text_selection(): void {
		const selection = session.selection as TextSelection;
		// The element that holds the annotated string
		const el = canvas_el?.querySelector(
			`[data-path="${selection.path.join('.')}"][data-type="text"]`
		) as HTMLElement | null;
		if (!el) return;
		const empty_text = (session.get(selection.path) as AnnotatedText).text.length === 0;
		const dom_selection = window.getSelection();
		if (!dom_selection) return;
		let current_offset = 0;
		let anchor_node: Node | undefined;
		let focus_node: Node | undefined;
		let anchor_node_offset = 0;
		let focus_node_offset = 0;
		const is_backward = selection.anchor_offset > selection.focus_offset;
		const start_offset = Math.min(selection.anchor_offset, selection.focus_offset);
		const end_offset = Math.max(selection.anchor_offset, selection.focus_offset);

		// Helper function to process each node
		function process_node(node: Node): boolean {
			if (node.nodeType === Node.TEXT_NODE) {
				const node_text = node.textContent ?? '';
				const node_char_length = get_char_length(node_text);

				if (is_backward) {
					if (!focus_node && current_offset + node_char_length >= start_offset) {
						focus_node = node;
						const char_offset = start_offset - current_offset;
						focus_node_offset = char_to_utf16_offset(node_text, char_offset);
					}
				} else {
					if (!anchor_node && current_offset + node_char_length >= start_offset) {
						anchor_node = node;
						const char_offset = start_offset - current_offset;
						anchor_node_offset = char_to_utf16_offset(node_text, char_offset);
					}
				}

				// Find end node
				if (is_backward) {
					if (!anchor_node && current_offset + node_char_length >= end_offset) {
						anchor_node = node;
						const char_offset = end_offset - current_offset;
						anchor_node_offset = char_to_utf16_offset(node_text, char_offset);
						return true; // Stop iteration
					}
				} else {
					if (!focus_node && current_offset + node_char_length >= end_offset) {
						focus_node = node;
						const char_offset = end_offset - current_offset;
						focus_node_offset = char_to_utf16_offset(node_text, char_offset);
						return true; // Stop iteration
					}
				}
				current_offset += node_char_length;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				for (const child_node of node.childNodes) {
					if (process_node(child_node)) return true; // Stop iteration if end found
				}
			}
			return false; // Continue iteration
		}

		// EDGE CASE: When text is empty, we need to set a different DOM selection
		if (start_offset === end_offset && start_offset === 0 && empty_text) {
			// Markup for empty text looks like this `<div data-type="text"><br></div>`.
			// And the correct caret position is after the <br> element.
			anchor_node = el;
			anchor_node_offset = 1;
			focus_node = el;
			focus_node_offset = 1;
		} else {
			// DEFAULT CASE
			for (const child_node of el.childNodes) {
				if (process_node(child_node)) break;
			}
		}

		// Set the range if both start and end were found
		if (anchor_node && focus_node) {
			dom_selection.removeAllRanges();
			// NOTE: Only using setBaseAndExtent() will preserve selection direction
			dom_selection.setBaseAndExtent(
				anchor_node,
				anchor_node_offset,
				focus_node,
				focus_node_offset
			);
			el.focus(); // needed?

			// Scroll the selection into view
			setTimeout(() => {
				const selectedElement = dom_selection.focusNode?.parentElement;
				if (selectedElement) {
					selectedElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				}
			}, 0);
		}
	}

	// Utils
	// --------------------------

	function __is_dom_selection_backwards(): boolean {
		const dom_selection = window.getSelection();

		// If there's no dom_selection, return false
		if (!dom_selection || dom_selection.rangeCount === 0) return false;

		// Get the range of the dom_selection
		const range = dom_selection.getRangeAt(0);

		if (range.collapsed) return false;

		if (!dom_selection.anchorNode || !dom_selection.focusNode) return false;

		// Create a new range for comparison
		const comparisonRange = range.cloneRange();

		// Set the comparison range to start at the dom_selection's anchor and end at its focus
		comparisonRange.setStart(dom_selection.anchorNode, dom_selection.anchorOffset);
		comparisonRange.setEnd(dom_selection.focusNode, dom_selection.focusOffset);

		// If the comparison range is collapsed, the selection is backwards
		return comparisonRange.collapsed;
	}

	// Whenever the model selection changes, render the selection
	// Skip when canvas is not focused to avoid stealing focus back
	// (e.g., when a dialog is open and selection highlight fragments re-render)
	$effect(() => {
		if (!canvas_focused) return;
		render_selection();
	});
</script>

<!--
  TODO: We must get rid of the global handlers here, so Svedit doesn't conflict
  with any app-specific event handling.
-->
<svelte:document {onselectionchange} {oncut} {oncopy} {onpaste} />

<!-- TODO: move oncut/copy/paste handlers inside .svedit -->
<div class="svedit">
	<!-- Overlays must be before canvas so they initialize first. -->
	<NodeSelectionMarkers />
	{#if Overlays}<Overlays />{/if}
	<div
		class="svedit-canvas {css_class}"
		class:hide-selection={session.selection?.type === 'node'}
		class:node-caret={session.selection?.type === 'node' &&
			session.selection.anchor_offset === session.selection.focus_offset}
		class:property-selection={session.selection?.type === 'property'}
		bind:this={canvas_el}
		{onbeforeinput}
		{oncompositionstart}
		{oncompositionend}
		onfocus={handle_canvas_focus}
		onblur={handle_canvas_blur}
		contenteditable={editable ? 'true' : 'false'}
		tabindex="-1"
		{autocapitalize}
		{spellcheck}
		{...{
			// NOTE: Autocomplete and autocorrect make immense troubles
			// on Desktop Chrome, so we disable them only for Chrome desktop.
			// Additionally, OSX-native auto-complete also breaks, because
			// I'm using a keyed block that always wipes the DOM of a text node
			// on every change.
			// autocomplete: is_chrome_desktop ? "off" : "on",
			// autocorrect: is_chrome_desktop ? "off" : "on"
		}}
	>
		<RootComponent {path} />
	</div>
</div>

<style>
	.svedit-canvas {
		caret-color: var(--svedit-editing-stroke);
		caret-shape: bar;
		/* Default to vertical/ column flow with: --row: 0; (the most common case)
		Prevents silent failures when developers forget to set the row property in their top level node component.
		TODO: Warn developers in dev mode via console if they forget to set the --row property and use a different flow.*/
		--row: 0;
		&:focus {
			outline: none;
		}
	}

	.svedit-canvas :global(::selection) {
		background: var(--svedit-editing-fill);
	}

	@media not (pointer: coarse) {
		.svedit-canvas.hide-selection {
			caret-color: transparent;
		}
	}

	/* When the caret is in a node gap we never want to see the caret */
	.svedit-canvas.node-caret,
	.svedit-canvas.property-selection {
		caret-color: transparent;
	}

	@media not (pointer: coarse) {
		@supports (anchor-name: --test) {
			.svedit-canvas.hide-selection :global(::selection) {
				background: transparent;
			}
		}
	}
</style>
