<script>
	import App from '../components/App.svelte';
	import { createEmptyDoc } from '$lib/new_page.js';

	const props = $props();
	const data = $derived({
		...props.data,
		document: createEmptyDoc(props.data.shared_documents ?? null),
		is_new: true
	});
</script>

<App {...data} />
