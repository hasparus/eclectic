<script lang="ts">
	import { getContext, setContext, type Component } from 'svelte';
	import UnknownNode from './UnknownNode.svelte';
	import { snake_to_pascal } from './utils.js';
	import DefaultNodeGap from './NodeGap.svelte';
	import DefaultNodeGapMarkers from './NodeGapMarkers.svelte';
	import type { NodeArrayPropertyProps, DocumentPath, DocumentNode } from './types.d.ts';
	import type Session from './Session.svelte.js';

	interface SveditCtx {
		session: Session & {
			config: {
				system_components?: {
					NodeGap?: Component<Record<string, unknown>>;
					NodeGapMarkers?: Component<Record<string, unknown>>;
				};
				node_components: Record<string, Component<Record<string, unknown>>>;
			};
		};
		editable: boolean;
		is_near_viewport?: (path: DocumentPath) => boolean;
	}

	const svedit = getContext<SveditCtx>('svedit');
	const NodeGap = $derived(svedit.session.config.system_components?.NodeGap ?? DefaultNodeGap);
	const NodeGapMarkers = $derived(
		svedit.session.config.system_components?.NodeGapMarkers ?? DefaultNodeGapMarkers
	);

	let {
		path,
		tag = 'div',
		class: css_class,
		style = '',
		...rest
	}: NodeArrayPropertyProps = $props();

	const nodes = $derived(
		(svedit.session.get(path) as string[]).map(
			(node_id: string) => svedit.session.get(node_id) as DocumentNode
		)
	);

	setContext('node_array_meta', {
		get length() {
			return nodes.length;
		}
	});
</script>
<!-- we use the anchor of node_array in Overlays.svelte to position the last insertion point in a horizontal layout based on the right edge of the container -->
<svelte:element 
	this={tag} 
	class={css_class} 
	data-type="node_array" 
	data-path={path.join('.')} 
	style="anchor-name: --{path.join('-')};{style ? ` ${style}` : ''}" {...rest}
>
	{#if nodes.length === 0 && svedit.editable}
		<!--
		Experimental: We'll let .empty-node-array act like a node, so the existing
		code paths for selection mapping will work as expected.

		TODO: Need to figure out a way to make .empty-node-array customizable.
		-->
		<div
			class="node empty-node-array"
			data-path={[...path, 0].join('.')}
			data-type="node"
			style="anchor-name: --{[...path, 0].join(
				'-'
			)}; min-height: 40px; min-width: 24px;"
		></div>
		<!-- Sibling (not child) of .empty-node-array so its .svedit-selectable
		     resolves anchor positioning against the shared containing block,
		     not the placeholder which inherits .node positioning styles. -->
		<NodeGap array_path={path} offset={0} count={0} empty />
	{/if}
	{#each nodes as node, index (index)}
		{#if svedit.editable}
			<NodeGap
				array_path={path}
				offset={index}
				count={nodes.length}
				positioned={svedit.is_near_viewport?.([...path, index]) ?? true}
			/>
		{/if}
		{@const Component = svedit.session.config.node_components[snake_to_pascal(node.type)]}
		{#if Component}
			<Component path={[...path, index]} />
		{:else}
			<UnknownNode path={[...path, index]} />
		{/if}
	{/each}
	{#if svedit.editable && nodes.length > 0}
		<NodeGap
			array_path={path}
			offset={nodes.length}
			count={nodes.length}
			positioned={svedit.is_near_viewport?.([...path, nodes.length - 1]) ?? true}
		/>
	{/if}
	{#if svedit.editable && NodeGapMarkers}
		<NodeGapMarkers {path} />
	{/if}
</svelte:element>
