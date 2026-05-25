<script lang="ts">
	import type { SveditCtx } from './types';
	import { getContext } from 'svelte';
	const svedit = getContext<SveditCtx>('svedit');
	let { path, content } = $props();
	let node = $derived(svedit.session.get(path));
</script>

<em id={node.id} data-node-id={node.id}>{content}</em>
