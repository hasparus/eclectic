<script lang="ts">
	import { getContext } from 'svelte';
	import Node from './Node.svelte';
	import type Session from './Session.svelte.js';
	import type { DocumentPath, DocumentNode } from './types.d.ts';

	const svedit = getContext<{ session: Session }>('svedit');
	const { path }: { path: DocumentPath } = $props();
	const node = $derived(svedit.session.get(path) as DocumentNode);
</script>

<Node {path}>
	Unknown: {node.type}.
</Node>
