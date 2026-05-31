import { Command, is_selection_collapsed } from '$lib/svedit';
import {
	getClosestSwitchableLayout,
	getColorsetNode,
	getClosestSwitchableType,
	type SwitchableTarget
} from './app_utils.js';

type Direction = 'next' | 'previous';

interface CommandContext {
	session: any;
	editable: boolean;
	[key: string]: any;
}

/**
 * Command that cycles through available layouts for a node. Direction
 * can be 'next' or 'previous'.
 */
export class CycleLayoutCommand extends Command {
	direction: Direction;
	closest_switchable_layout = $derived<SwitchableTarget | null>(
		getClosestSwitchableLayout(this.context.session, this.context.session.config)
	);

	constructor(direction: Direction, context: CommandContext) {
		super(context);
		this.direction = direction;
	}

	is_enabled() {
		return this.context.editable && this.closest_switchable_layout !== null;
	}

	execute() {
		if (!this.closest_switchable_layout) return;
		const session = this.context.session;
		const { node, node_array_path, node_index } = this.closest_switchable_layout;
		const layout_count = session.config.node_layouts[node.type];

		let new_layout: number;
		if (this.direction === 'next') {
			new_layout = (node.layout % layout_count) + 1;
		} else {
			new_layout = ((node.layout - 2 + layout_count) % layout_count) + 1;
		}

		const tr = session.tr;
		tr.set_selection({
			type: 'node',
			path: node_array_path,
			anchor_offset: node_index,
			focus_offset: node_index + 1
		});
		tr.set([node.id, 'layout'], new_layout);
		session.apply(tr);
	}
}

/**
 * Command that cycles through available node types in a node array.
 */
export class CycleNodeTypeCommand extends Command {
	direction: Direction;
	closest_switchable_type = $derived<SwitchableTarget | null>(
		getClosestSwitchableType(this.context.session)
	);

	constructor(direction: Direction, context: CommandContext) {
		super(context);
		this.direction = direction;
	}

	is_enabled() {
		return this.context.editable && this.closest_switchable_type !== null;
	}

	execute() {
		if (!this.closest_switchable_type) return;
		const session = this.context.session;
		const { node, node_array_path, node_index } = this.closest_switchable_type;
		const node_array_schema = session.inspect(node_array_path);
		const node_types: string[] = node_array_schema.node_types;

		const current_type_index = node_types.indexOf(node.type);
		let new_type_index: number;

		if (this.direction === 'next') {
			new_type_index = (current_type_index + 1) % node_types.length;
		} else {
			new_type_index = (current_type_index - 1 + node_types.length) % node_types.length;
		}

		const new_type = node_types[new_type_index];
		const tr = session.tr;
		tr.set_selection({
			type: 'node',
			path: node_array_path,
			anchor_offset: node_index,
			focus_offset: node_index + 1
		});
		session.config.inserters[new_type](tr);
		session.apply(tr);
	}
}

/**
 * Cycles colorset (0, 1, 2) on the nearest ancestor with `colorset`.
 */
export class CycleColorsetCommand extends Command {
	colorset_node = $derived<any | null>(getColorsetNode(this.context.session));

	is_enabled() {
		return this.context.editable && this.colorset_node !== null;
	}

	execute() {
		const session = this.context.session;
		const node = this.colorset_node;
		if (!node) return;

		const new_colorset = (node.colorset + 1) % 3;

		const tr = session.tr;
		tr.set([node.id, 'colorset'], new_colorset);
		session.apply(tr);
	}
}

export class ReplaceMediaCommand extends Command {
	is_enabled() {
		const session = this.context.session;
		if (!this.context.editable || session.selection?.type !== 'property') return false;
		const selected_property = session.get(session.selection.path);
		return selected_property?.type === 'image' || selected_property?.type === 'video';
	}

	execute() {
		if (!this.is_enabled()) return;

		const selection_path = this.context.session.selection?.path;
		if (!selection_path) return;

		document.documentElement.dataset.replaceMediaPath = JSON.stringify(selection_path);
		const replace_media_input = document.getElementById(
			'replace-media-input'
		) as HTMLInputElement | null;
		replace_media_input?.click();
	}
}

export class EditImageCommand extends Command {
	show_prompt = $state(false);

	constructor(context: CommandContext) {
		super(context);

		$effect(() => {
			// Track selection
			this.context.session.selection;
			this.show_prompt = false;
		});
	}

	is_enabled() {
		const session = this.context.session;
		if (!this.context.editable || session.selection?.type !== 'property') return false;
		const selected_property = session.get(session.selection.path);
		return selected_property?.type === 'image' || selected_property?.type === 'video';
	}

	execute() {
		if (!this.is_enabled()) return;

		setTimeout(() => {
			this.show_prompt = true;
		}, 0);
	}
}

/**
 * Toggles link annotations on text selections. Shows a prompt for URL
 * when creating a link.
 */
export class ToggleLinkCommand extends Command {
	active = $derived(this.is_active());
	show_prompt = $state(false);

	constructor(context: CommandContext) {
		super(context);

		$effect(() => {
			this.context.session.selection;
			this.show_prompt = false;
		});
	}

	is_active() {
		return this.context.session.active_annotation('link');
	}

	is_enabled() {
		const { session, editable } = this.context;

		const can_remove_link = session.active_annotation('link');
		const can_create_link =
			!session.active_annotation() && !is_selection_collapsed(session.selection);
		return editable && session.selection?.type === 'text' && (can_remove_link || can_create_link);
	}

	execute() {
		const session = this.context.session;
		const has_active_link = session.active_annotation('link');

		if (has_active_link) {
			session.apply(session.tr.annotate_text('link'));
		} else {
			this.show_prompt = true;
		}
	}
}

/**
 * Opens the edit-link dialog for link-ish nodes (nodes with `href`).
 */
export class EditLinkCommand extends Command {
	show_prompt = $state(false);

	constructor(context: CommandContext) {
		super(context);

		$effect(() => {
			this.context.session.selection;
			this.show_prompt = false;
		});
	}

	is_enabled() {
		const { session, editable } = this.context;
		if (!editable || !session.selection) return false;

		const selected_node = session.selected_node;
		if (selected_node && 'href' in selected_node) return true;

		const active_link = session.active_annotation('link');
		if (active_link) return true;

		return false;
	}

	execute() {
		if (this.is_enabled()) {
			const { session } = this.context;
			const active_link = session.active_annotation('link');
			if (
				!active_link &&
				(session.selection?.type === 'text' || session.selection?.type === 'property')
			) {
				session.select_parent();
			}
			setTimeout(() => {
				this.show_prompt = true;
			}, 0);
		}
	}
}
