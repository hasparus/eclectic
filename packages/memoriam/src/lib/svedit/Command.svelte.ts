import { insert_default_node, break_text_node } from './transforms.svelte.js';
import { is_selection_collapsed, is_mobile_browser, get_char_length } from './utils.js';
import type Session from './Session.svelte.js';
import type { AnnotatedText } from './types.d.ts';

/**
 * The host environment a `Command` reaches into. Loosely typed —
 * different apps stuff their own state alongside the editor here —
 * but the two fields below are always present.
 */
export interface CommandContext {
	session: Session;
	editable: boolean;
	[key: string]: unknown;
}

/**
 * Base class for commands that can be executed in response to user
 * actions like keyboard shortcuts, menu items, or toolbar buttons.
 *
 * Commands are stateful and UI-aware, unlike transforms which are
 * pure functions. They can have derived state (`is_active` for
 * toggle commands) or their own state (form inputs for
 * prompt-based commands).
 */
export default class Command {
	context: CommandContext;

	/** Derived disabled state — automatically computed from `is_enabled()`. */
	disabled = $derived(!this.is_enabled());

	constructor(context: CommandContext) {
		this.context = context;
	}

	/**
	 * Override to indicate whether the command can currently run.
	 * Default returns `true`.
	 */
	is_enabled(): boolean {
		return true;
	}

	/**
	 * Override to implement the command's behaviour. May be async.
	 */
	execute(): void | Promise<void> {
		throw new Error('Not implemented');
	}
}

/** Undo the last change. */
export class UndoCommand extends Command {
	is_enabled(): boolean {
		return this.context.editable && this.context.session.can_undo;
	}

	execute(): void {
		this.context.session.undo();
	}
}

/** Redo the last undone change. */
export class RedoCommand extends Command {
	is_enabled(): boolean {
		return this.context.editable && Boolean(this.context.session.can_redo);
	}

	execute(): void {
		this.context.session.redo();
	}
}

/** Move the selection up to the parent of the current selection. */
export class SelectParentCommand extends Command {
	is_enabled(): boolean {
		return this.context.editable && Boolean(this.context.session.selection);
	}

	execute(): void {
		this.context.session.select_parent();
	}
}

/**
 * Toggle an annotation node-type on the current text selection.
 * Used for simple annotations like bold, italic, highlight.
 */
export class ToggleAnnotationCommand extends Command {
	node_type: string;

	constructor(node_type: string, context: CommandContext) {
		super(context);
		this.node_type = node_type;
	}

	active = $derived(this.is_active());

	is_active(): boolean {
		return Boolean(this.context.session.active_annotation(this.node_type));
	}

	is_enabled(): boolean {
		const { session, editable } = this.context;
		const has_annotation = session.active_annotation(this.node_type);
		const no_annotation_and_caret_not_collapsed =
			!session.active_annotation() && !is_selection_collapsed(session.selection);

		return (
			editable &&
			session.selection?.type === 'text' &&
			Boolean(has_annotation || no_annotation_and_caret_not_collapsed)
		);
	}

	execute(): void {
		const { session } = this.context;
		session.apply(session.tr.annotate_text(this.node_type));
	}
}

/**
 * Insert a newline character at the caret. Only works inside
 * `allow_newlines` text props; disabled on mobile (Shift+Enter
 * behaves differently there).
 */
export class AddNewLineCommand extends Command {
	is_enabled(): boolean {
		const { session } = this.context;
		const selection = session.selection;

		return (
			this.context.editable &&
			!is_mobile_browser() &&
			selection?.type === 'text' &&
			Boolean(session.inspect(selection.path).allow_newlines)
		);
	}

	execute(): void {
		const { session } = this.context;
		session.apply(session.tr.insert_text('\n'));
	}
}

/** Break the current text node at the caret. */
export class BreakTextNodeCommand extends Command {
	is_enabled(): boolean {
		return this.context.editable && this.context.session.selection?.type === 'text';
	}

	execute(): void {
		const { session } = this.context;
		const tr = session.tr;
		if (break_text_node(tr)) {
			session.apply(tr);
		}
	}
}

/**
 * Expand the selection progressively — text → containing node →
 * parent node array. The user typically presses Cmd+A; each press
 * widens the scope one level.
 */
export class SelectAllCommand extends Command {
	is_enabled(): boolean {
		return this.context.editable && Boolean(this.context.session.selection);
	}

	execute(): void {
		const { session } = this.context;
		const selection = session.selection;

		if (!selection) {
			return;
		}

		if (selection.type === 'text') {
			const text_content = session.get(selection.path) as AnnotatedText;
			const text_length = get_char_length(text_content.text);

			const is_all_text_selected =
				Math.min(selection.anchor_offset, selection.focus_offset) === 0 &&
				Math.max(selection.anchor_offset, selection.focus_offset) === text_length;

			if (!is_all_text_selected) {
				session.selection = {
					type: 'text',
					path: selection.path,
					anchor_offset: 0,
					focus_offset: text_length
				};
			} else {
				const node_path = selection.path.slice(0, -1);

				if (node_path.length >= 2) {
					const is_inside_node_array =
						session.inspect(node_path.slice(0, -1)).type === 'node_array';

					if (is_inside_node_array) {
						const node_index = parseInt(String(node_path.at(-1)));
						session.selection = {
							type: 'node',
							path: node_path.slice(0, -1),
							anchor_offset: node_index,
							focus_offset: node_index + 1
						};
					}
				}
			}
		} else if (selection.type === 'node') {
			const node_array_path = selection.path;
			const node_array = session.get(node_array_path) as unknown[];

			const is_entire_node_array_selected =
				Math.min(selection.anchor_offset, selection.focus_offset) === 0 &&
				Math.max(selection.anchor_offset, selection.focus_offset) === node_array.length;

			if (!is_entire_node_array_selected) {
				session.selection = {
					type: 'node',
					path: node_array_path,
					anchor_offset: 0,
					focus_offset: node_array.length
				};
			} else {
				const parent_path = node_array_path.slice(0, -1);

				if (parent_path.length >= 2) {
					const is_parent_node_array =
						session.inspect(parent_path.slice(0, -1)).type === 'node_array';

					if (is_parent_node_array) {
						const parent_node_index = parseInt(String(parent_path.at(-1)));
						session.selection = {
							type: 'node',
							path: parent_path.slice(0, -1),
							anchor_offset: parent_node_index,
							focus_offset: parent_node_index + 1
						};
					}
				}
			}
		} else if (selection.type === 'property') {
			const node_path = selection.path.slice(0, -1);

			if (node_path.length >= 2) {
				const is_inside_node_array =
					session.inspect(node_path.slice(0, -1)).type === 'node_array';

				if (is_inside_node_array) {
					const node_index = parseInt(String(node_path.at(-1)));
					session.selection = {
						type: 'node',
						path: node_path.slice(0, -1),
						anchor_offset: node_index,
						focus_offset: node_index + 1
					};
				}
			}
		}
	}
}

/** Insert the default node at the current caret. */
export class InsertDefaultNodeCommand extends Command {
	is_enabled(): boolean {
		const selection = this.context.session.selection;
		return (
			this.context.editable &&
			selection?.type === 'node' &&
			selection.anchor_offset === selection.focus_offset
		);
	}

	execute(): void {
		const { session } = this.context;
		const tr = session.tr;
		insert_default_node(tr);
		session.apply(tr);
	}
}
