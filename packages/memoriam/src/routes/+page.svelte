<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import App from './components/App.svelte';
	import { subscribeToPageBroadcast } from '$lib/page_doc_client.svelte';

	interface Props {
		data: {
			is_admin?: boolean;
			origin?: string | null;
			document: any;
			slug: string | null;
			is_new?: boolean;
			page_doc_url?: string;
		};
	}
	const props: Props = $props();

	// Live updates: when any tab on this site saves / renames /
	// deletes a page, the per-site page-broadcast Automerge doc
	// ticks and we `invalidateAll()` so the rendered HTML refreshes
	// against the new SQLite state.
	const siteId = pageState.data.site_id as string | null;
	if (siteId && props.data.page_doc_url) {
		subscribeToPageBroadcast(siteId, props.data.page_doc_url, () => {
			void invalidateAll();
		});
	}
</script>

<!--
	BUG: When navigating from / with preloading on the Svedit component ends up
	with a stale session, breaking editing.
	See https://github.com/michael/editable-website/issues/40
-->
<!-- {#key initial_doc.document_id} -->
<App {...props.data} />
<!-- {/key} -->
