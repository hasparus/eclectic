<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import LocaleSwitcher from '$lib/LocaleSwitcher.svelte';

	let email = $state('');
	let pending = $state(false);
	let error = $state('');
	let sent_to = $state<string | null>(null);

	let next = $derived.by(() => {
		const raw = page.url.searchParams.get('next');
		return raw && raw.startsWith('/') ? raw : null;
	});

	async function submit() {
		if (pending) return;
		const trimmed = email.trim();
		if (!trimmed || !trimmed.includes('@')) {
			error = m.signin_error_invalid_email();
			return;
		}
		pending = true;
		error = '';
		try {
			const api = await import('$lib/api.remote.js');
			// `.updates()` with no args opts out of the implicit page
			// invalidation that `command()` would otherwise trigger under
			// `experimental.async` — that invalidation re-runs the load
			// and re-mounts the component, wiping `sent_to`.
			const result = (await api
				.requestMagicLink({
					email: trimmed,
					next: next ?? undefined
				})
				.updates()) as { ok: true } | { ok: false; code: string; message: string };
			if (result.ok === false) {
				error = result.message || m.signin_error_generic();
				return;
			}
			sent_to = trimmed;
		} catch (err) {
			error = err instanceof Error ? err.message : m.signin_error_generic();
		} finally {
			pending = false;
		}
	}

	function handle_keydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			void submit();
		}
	}
</script>

<svelte:head><title>{m.signin_title()}</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-8 px-6 py-24 text-(--foreground)">
	<div class="flex justify-end">
		<LocaleSwitcher />
	</div>

	<header class="flex flex-col items-center gap-2 text-center">
		<h1 class="m-0 text-2xl font-medium">{m.signin_title()}</h1>
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			{m.signin_subtitle()}
		</p>
	</header>

	{#if sent_to}
		<section aria-live="polite" class="flex flex-col items-center gap-2 text-center">
			<p class="m-0 text-base">{m.signin_check_email_heading()}</p>
			<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
				{m.signin_check_email_body({ email: sent_to })}
			</p>
		</section>
	{:else}
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1 text-sm">
				<span>{m.signin_email_label()}</span>
				<input
					type="email"
					name="email"
					bind:value={email}
					placeholder={m.signin_email_placeholder()}
					autocomplete="email"
					onkeydown={handle_keydown}
					class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
				/>
			</label>

			<button
				type="button"
				onclick={() => void submit()}
				disabled={pending}
				class="self-stretch border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
			>
				{pending ? m.signin_submit_pending() : m.signin_submit()}
			</button>

			{#if error}
				<p class="text-sm text-red-600" role="alert">{error}</p>
			{/if}
		</div>
	{/if}
</main>
