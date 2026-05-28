<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	interface Props {
		data: { ok: boolean; reason?: string };
	}
	let { data }: Props = $props();

	function reasonMessage(reason: string | undefined): string {
		switch (reason) {
			case 'missing_token':
				return m.auth_invite_error_missing_token();
			case 'unknown':
				return m.auth_invite_error_unknown();
			case 'expired':
				return m.auth_invite_error_expired();
			case 'already_consumed':
				return m.auth_invite_error_already_consumed();
			case 'email_mismatch':
				return m.auth_invite_error_email_mismatch();
			case 'unknown_user':
				return m.auth_invite_error_unknown_user();
			default:
				return m.auth_invite_error_generic();
		}
	}
</script>

<svelte:head><title>{m.auth_invite_error_heading()}</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-center text-(--foreground)">
	<h1 class="m-0 text-xl font-medium">{m.auth_invite_error_heading()}</h1>
	<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_64%,transparent)]">
		{reasonMessage(data.reason)}
	</p>
	<a href="/sites" class="text-sm text-(--svedit-editing-stroke) underline">{m.auth_invite_back_link()}</a>
</main>
