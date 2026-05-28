<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import LocaleSwitcher from '$lib/LocaleSwitcher.svelte';

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

	function roleLabel(role: SiteEntry['role']): string {
		return role === 'owner'
			? m.common_role_owner()
			: role === 'editor'
				? m.common_role_editor()
				: m.common_role_viewer();
	}

	function visibilityLabel(v: SiteEntry['visibility']): string {
		return v === 'public'
			? m.common_visibility_short_public()
			: v === 'unlisted'
				? m.common_visibility_short_unlisted()
				: m.common_visibility_short_private();
	}

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
				error = result.message || m.sites_create_error();
				return;
			}
			display_name = '';
			visibility = 'public';
			// Refresh the listing so the new site appears. We don't
			// auto-navigate to /sites/[id] — under experimental.async
			// goto here races the load re-run and bounces us back.
			await invalidateAll();
		} catch (err) {
			error = err instanceof Error ? err.message : m.sites_create_error();
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

<svelte:head><title>{m.sites_title()}</title></svelte:head>

<main class="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 text-(--foreground)">
	<header class="flex items-baseline justify-between">
		<h1 class="m-0 text-2xl font-medium">{m.sites_title()}</h1>
		<div class="flex items-center gap-3 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			<LocaleSwitcher />
			<span>{data.user_email}</span>
			<button class="underline" onclick={() => void logout()}>{m.common_sign_out()}</button>
		</div>
	</header>

	{#if data.sites.length === 0}
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			{m.sites_empty()}
		</p>
	{:else}
		<ul class="flex flex-col divide-y divide-[color-mix(in_oklch,var(--foreground)_15%,transparent)] border-y border-[color-mix(in_oklch,var(--foreground)_15%,transparent)]">
			{#each data.sites as site (site.site_id)}
				<li class="flex items-center justify-between py-3">
					<a href={`/sites/${site.site_id}`} class="flex flex-col gap-0.5">
						<span class="font-medium">{site.display_name || site.site_id}</span>
						<span class="text-xs text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
							{m.sites_row_meta({
								siteId: site.site_id,
								visibility: visibilityLabel(site.visibility),
								role: roleLabel(site.role)
							})}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<section class="flex flex-col gap-3 border-t border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] pt-6">
		<h2 class="m-0 text-lg font-medium">{m.sites_new_section_heading()}</h2>
		<input
			type="text"
			placeholder={m.sites_display_name_placeholder()}
			bind:value={display_name}
			class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
		/>
		<select
			bind:value={visibility}
			class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
		>
			<option value="public">{m.common_visibility_public()}</option>
			<option value="unlisted">{m.common_visibility_unlisted()}</option>
			<option value="private">{m.common_visibility_private()}</option>
		</select>
		<button
			type="button"
			onclick={() => void create()}
			disabled={pending}
			class="self-start border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
		>
			{pending ? m.sites_create_submit_pending() : m.sites_create_submit()}
		</button>
		{#if error}
			<div class="text-sm text-red-600">{error}</div>
		{/if}
	</section>
</main>
