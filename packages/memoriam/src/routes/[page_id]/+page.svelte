<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import App from '../components/App.svelte';
	import { subscribeToPageBroadcast } from '$lib/page_doc_client.svelte';

	interface Props {
		data: {
			document: any;
			slug: string | null;
			is_admin?: boolean;
			is_new?: boolean;
			origin?: string | null;
			page_doc_url?: string;
		};
	}
	const props: Props = $props();

	// Same per-site page-broadcast subscription as the home route.
	const siteId = pageState.data.site_id as string | null;
	if (siteId && props.data.page_doc_url) {
		subscribeToPageBroadcast(siteId, props.data.page_doc_url, () => {
			void invalidateAll();
		});
	}
</script>

<App {...props.data} is_new={false} />
