<script lang="ts">
	interface Props {
		data: { ok: boolean; reason?: string };
	}
	let { data }: Props = $props();

	const reason_message: Record<string, string> = {
		missing_token: 'No sign-in token was provided.',
		unknown: 'This sign-in link is not recognized.',
		expired: 'This sign-in link has expired. Request a new one.',
		already_consumed: 'This sign-in link has already been used.'
	};
</script>

<svelte:head><title>Sign in</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-center text-(--foreground)">
	<h1 class="m-0 text-xl font-medium">Sign-in link error</h1>
	<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_64%,transparent)]">
		{reason_message[data.reason ?? 'unknown'] ?? 'Could not sign you in.'}
	</p>
	<a href="/" class="text-sm text-(--svedit-editing-stroke) underline">Go back home</a>
</main>
