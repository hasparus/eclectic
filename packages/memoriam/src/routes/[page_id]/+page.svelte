<script lang="ts">
	import App from '../components/App.svelte';

	interface Props {
		data: {
			document: any;
			slug: string | null;
			is_admin?: boolean;
			is_new?: boolean;
			origin?: string | null;
		};
	}
	const props: Props = $props();
</script>

<App {...props.data} is_new={false} />
