<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	interface SiteEntry {
		site_id: string;
		display_name: string | null;
		visibility: 'public' | 'unlisted' | 'private';
		role: 'owner' | 'editor' | 'viewer';
		created_at: string;
		updated_at: string;
	}

	interface Props {
		data: { sites: SiteEntry[]; user_email: string | null };
	}
	let { data }: Props = $props();

	let display_name = $state('');
	let visibility = $state<'public' | 'unlisted' | 'private'>('public');
	let pending = $state(false);
	let error = $state('');

	async function create() {
		if (pending) return;
		pending = true;
		error = '';
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.createSite({
				display_name: display_name.trim() || undefined,
				visibility
			})) as
				| { ok: true; site: { site_id: string } }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				error = result.message || 'Could not create site.';
				return;
			}
			display_name = '';
			visibility = 'public';
			await invalidateAll();
			await goto(`/sites/${result.site.site_id}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create site.';
		} finally {
			pending = false;
		}
	}

	async function logout() {
		const api = await import('$lib/api.remote.js');
		await api.logout();
		await goto('/');
	}
</script>

<svelte:head><title>Your memorials</title></svelte:head>

<main class="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 text-(--foreground)">
	<header class="flex items-baseline justify-between">
		<h1 class="m-0 text-2xl font-medium">Your memorials</h1>
		<div class="flex items-center gap-3 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			<span>{data.user_email}</span>
			<button class="underline" onclick={() => void logout()}>Sign out</button>
		</div>
	</header>

	{#if data.sites.length === 0}
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			You don't have any memorials yet. Create your first one below.
		</p>
	{:else}
		<ul class="flex flex-col divide-y divide-[color-mix(in_oklch,var(--foreground)_15%,transparent)] border-y border-[color-mix(in_oklch,var(--foreground)_15%,transparent)]">
			{#each data.sites as site (site.site_id)}
				<li class="flex items-center justify-between py-3">
					<a href={`/sites/${site.site_id}`} class="flex flex-col gap-0.5">
						<span class="font-medium">{site.display_name || site.site_id}</span>
						<span class="text-xs text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
							{site.site_id} · {site.visibility} · you are {site.role}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<section class="flex flex-col gap-3 border-t border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] pt-6">
		<h2 class="m-0 text-lg font-medium">New memorial</h2>
		<input
			type="text"
			placeholder="Display name (e.g. Grandma Edith)"
			bind:value={display_name}
			class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
		/>
		<select
			bind:value={visibility}
			class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
		>
			<option value="public">Public — anyone with the link</option>
			<option value="unlisted">Unlisted — link required, not searchable</option>
			<option value="private">Private — only invited members</option>
		</select>
		<button
			type="button"
			onclick={() => void create()}
			disabled={pending}
			class="self-start border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
		>
			{pending ? 'Creating…' : 'Create memorial'}
		</button>
		{#if error}
			<div class="text-sm text-red-600">{error}</div>
		{/if}
	</section>
</main>
