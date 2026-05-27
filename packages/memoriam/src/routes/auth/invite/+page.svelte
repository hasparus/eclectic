<script lang="ts">
	interface Props {
		data: { ok: boolean; reason?: string };
	}
	let { data }: Props = $props();

	const reason_message: Record<string, string> = {
		missing_token: 'No invite token was provided.',
		unknown: 'This invite is not recognized.',
		expired: 'This invite has expired. Ask for a new one.',
		already_consumed: 'This invite has already been used.',
		email_mismatch: 'This invite was sent to a different email address. Sign out and sign back in with the invited email.',
		unknown_user: 'Your account was not found.'
	};
</script>

<svelte:head><title>Invite</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-center text-(--foreground)">
	<h1 class="m-0 text-xl font-medium">Couldn't accept invite</h1>
	<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_64%,transparent)]">
		{reason_message[data.reason ?? 'unknown'] ?? 'Something went wrong.'}
	</p>
	<a href="/sites" class="text-sm text-(--svedit-editing-stroke) underline">Your memorials</a>
</main>
