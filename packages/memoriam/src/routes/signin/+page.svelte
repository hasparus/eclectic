<script lang="ts">
	import { page } from '$app/state';

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
			error = 'Enter a valid email address.';
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
				error = result.message || 'Could not send link.';
				return;
			}
			sent_to = trimmed;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not send link.';
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

<svelte:head><title>Sign in</title></svelte:head>

<main class="mx-auto flex max-w-md flex-col gap-8 px-6 py-24 text-(--foreground)">
	<header class="flex flex-col items-center gap-2 text-center">
		<h1 class="m-0 text-2xl font-medium">Sign in</h1>
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			We'll email you a link to sign in.
		</p>
	</header>

	{#if sent_to}
		<section aria-live="polite" class="flex flex-col items-center gap-2 text-center">
			<p class="m-0 text-base">Check your email.</p>
			<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
				We sent a sign-in link to <strong class="text-(--foreground)">{sent_to}</strong>.
			</p>
		</section>
	{:else}
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1 text-sm">
				<span>Email</span>
				<input
					type="email"
					name="email"
					bind:value={email}
					placeholder="you@example.com"
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
				{pending ? 'Sending…' : 'Send link'}
			</button>

			{#if error}
				<p class="text-sm text-red-600" role="alert">{error}</p>
			{/if}
		</div>
	{/if}
</main>
