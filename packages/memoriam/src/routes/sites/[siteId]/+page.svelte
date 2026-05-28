<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';

	interface Member {
		site_id: string;
		user_id: string;
		role: 'owner' | 'editor' | 'viewer';
		email: string | null;
		created_at: string;
	}

	interface Invite {
		invite_token: string;
		email: string;
		role: 'owner' | 'editor' | 'viewer';
		created_at: string;
		expires_at: string;
	}

	interface ShortCodeEntry {
		code: string;
		site_id: string;
		target_path: string;
		created_at: string;
	}

	interface Props {
		data: {
			site: { site_id: string; display_name: string | null; visibility: string; created_at: string };
			current_user_id: string;
			current_user_role: 'owner' | 'editor' | 'viewer';
			members: Member[];
			invites: Invite[];
			short_codes: ShortCodeEntry[];
		};
	}
	let { data }: Props = $props();

	let is_owner = $derived(data.current_user_role === 'owner');

	let qr_pending = $state(false);
	let qr_error = $state('');

	function roleLabel(role: 'owner' | 'editor' | 'viewer'): string {
		return role === 'owner'
			? m.common_role_owner()
			: role === 'editor'
				? m.common_role_editor()
				: m.common_role_viewer();
	}

	function visibilityLabel(v: string): string {
		return v === 'public'
			? m.common_visibility_short_public()
			: v === 'unlisted'
				? m.common_visibility_short_unlisted()
				: m.common_visibility_short_private();
	}

	async function mint_short_code() {
		if (qr_pending) return;
		qr_pending = true;
		qr_error = '';
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.issueSiteShortCode({ site_id: data.site.site_id })) as
				| { ok: true; short_code: ShortCodeEntry }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				qr_error = result.message || m.qr_generate_error();
				return;
			}
			await invalidateAll();
		} catch (err) {
			qr_error = err instanceof Error ? err.message : m.qr_generate_error();
		} finally {
			qr_pending = false;
		}
	}

	let invite_email = $state('');
	let invite_role = $state<'editor' | 'viewer'>('editor');
	let invite_pending = $state(false);
	let invite_error = $state('');
	let invite_sent_to = $state<string | null>(null);

	async function send_invite() {
		if (invite_pending) return;
		const trimmed = invite_email.trim();
		if (!trimmed || !trimmed.includes('@')) {
			invite_error = m.invite_error_invalid_email();
			return;
		}
		invite_pending = true;
		invite_error = '';
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.inviteMember({
				site_id: data.site.site_id,
				email: trimmed,
				role: invite_role
			})) as
				| { ok: true; invite_token: string; email: string }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				invite_error = result.message || m.invite_error_generic();
				return;
			}
			invite_sent_to = trimmed;
			invite_email = '';
			await invalidateAll();
		} catch (err) {
			invite_error = err instanceof Error ? err.message : m.invite_error_generic();
		} finally {
			invite_pending = false;
		}
	}

	async function revoke(token: string) {
		const api = await import('$lib/api.remote.js');
		await api.revokeMemberInvite({ site_id: data.site.site_id, invite_token: token });
		await invalidateAll();
	}

	async function change_role(user_id: string, role: 'owner' | 'editor' | 'viewer') {
		const api = await import('$lib/api.remote.js');
		await api.changeMemberRoleCommand({ site_id: data.site.site_id, user_id, role });
		await invalidateAll();
	}

	async function remove(user_id: string) {
		const api = await import('$lib/api.remote.js');
		const result = (await api.removeMemberCommand({
			site_id: data.site.site_id,
			user_id
		})) as { ok: true } | { ok: false; code: string; message: string };
		if (result.ok === false) {
			alert(result.message);
			return;
		}
		if (user_id === data.current_user_id) {
			await goto('/sites');
			return;
		}
		await invalidateAll();
	}

	async function transfer(to_user_id: string) {
		if (!confirm(m.site_members_transfer_confirm())) return;
		const api = await import('$lib/api.remote.js');
		const result = (await api.transferSiteOwnership({
			site_id: data.site.site_id,
			to_user_id
		})) as { ok: true } | { ok: false; code: string; message: string };
		if (result.ok === false) {
			alert(result.message);
			return;
		}
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.site.display_name || data.site.site_id}</title></svelte:head>

<main class="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 text-(--foreground)">
	<header class="flex flex-col gap-1">
		<a href="/sites" class="text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)] underline">
			← {m.common_back_to_sites()}
		</a>
		<h1 class="m-0 text-2xl font-medium">{data.site.display_name || data.site.site_id}</h1>
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			{m.site_meta_line({ siteId: data.site.site_id, visibility: visibilityLabel(data.site.visibility) })}
		</p>
		<a
			href={`/sites/${data.site.site_id}/tree`}
			class="text-sm text-(--svedit-editing-stroke) underline"
		>
			{m.site_tree_link()}
		</a>
	</header>

	<section class="flex flex-col gap-3">
		<h2 class="m-0 text-lg font-medium">{m.site_members_heading()}</h2>
		<ul class="flex flex-col divide-y divide-[color-mix(in_oklch,var(--foreground)_15%,transparent)] border-y border-[color-mix(in_oklch,var(--foreground)_15%,transparent)]">
			{#each data.members as member (member.user_id)}
				<li class="flex items-center justify-between py-3">
					<div class="flex flex-col gap-0.5">
						<span class="font-medium">{member.email ?? member.user_id}</span>
						<span class="text-xs text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
							{roleLabel(member.role)}{member.user_id === data.current_user_id ? m.site_members_you_suffix() : ''}
						</span>
					</div>
					<div class="flex items-center gap-2 text-sm">
						{#if is_owner && member.user_id !== data.current_user_id}
							<select
								value={member.role}
								onchange={(e) => void change_role(member.user_id, (e.currentTarget as HTMLSelectElement).value as any)}
								class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
							>
								<option value="owner">{m.common_role_owner()}</option>
								<option value="editor">{m.common_role_editor()}</option>
								<option value="viewer">{m.common_role_viewer()}</option>
							</select>
							{#if member.role !== 'owner'}
								<button class="underline" onclick={() => void transfer(member.user_id)}>{m.site_members_make_owner()}</button>
							{/if}
							<button class="underline text-red-600" onclick={() => void remove(member.user_id)}>{m.site_members_remove()}</button>
						{/if}
						{#if member.user_id === data.current_user_id && (member.role !== 'owner' || data.members.filter((x) => x.role === 'owner').length > 1)}
							<button class="underline text-red-600" onclick={() => void remove(member.user_id)}>{m.site_members_leave()}</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	{#if is_owner}
		<section class="flex flex-col gap-3">
			<h2 class="m-0 text-lg font-medium">{m.invite_section_heading()}</h2>
			<div class="flex items-stretch gap-2">
				<input
					type="email"
					placeholder={m.invite_email_placeholder()}
					bind:value={invite_email}
					class="flex-1 border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
				/>
				<select
					bind:value={invite_role}
					class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-3 py-2 text-base"
				>
					<option value="editor">{m.common_role_editor()}</option>
					<option value="viewer">{m.common_role_viewer()}</option>
				</select>
				<button
					type="button"
					onclick={() => void send_invite()}
					disabled={invite_pending}
					class="border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
				>
					{invite_pending ? m.invite_submit_pending() : m.invite_submit()}
				</button>
			</div>
			{#if invite_sent_to}
				<div class="text-sm text-(--svedit-editing-stroke)">{m.invite_sent_confirmation({ email: invite_sent_to })}</div>
			{/if}
			{#if invite_error}
				<div class="text-sm text-red-600">{invite_error}</div>
			{/if}

			{#if data.invites.length > 0}
				<h3 class="m-0 mt-3 text-base font-medium">{m.invite_pending_heading()}</h3>
				<ul class="flex flex-col divide-y divide-[color-mix(in_oklch,var(--foreground)_15%,transparent)] border-y border-[color-mix(in_oklch,var(--foreground)_15%,transparent)]">
					{#each data.invites as inv (inv.invite_token)}
						<li class="flex items-center justify-between py-3 text-sm">
							<div class="flex flex-col gap-0.5">
								<span>{inv.email}</span>
								<span class="text-xs text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
									{m.invite_pending_expires({ role: roleLabel(inv.role), date: new Date(inv.expires_at).toLocaleDateString() })}
								</span>
							</div>
							<button class="underline text-red-600" onclick={() => void revoke(inv.invite_token)}>{m.invite_revoke()}</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<section class="flex flex-col gap-3">
		<h2 class="m-0 text-lg font-medium">{m.qr_section_heading()}</h2>
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			{m.qr_section_intro()}
		</p>

		<div>
			<button
				type="button"
				onclick={() => void mint_short_code()}
				disabled={qr_pending}
				class="border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
			>
				{qr_pending ? m.qr_generate_submit_pending() : m.qr_generate_submit()}
			</button>
		</div>
		{#if qr_error}
			<div class="text-sm text-red-600">{qr_error}</div>
		{/if}

		{#if data.short_codes.length > 0}
			<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{#each data.short_codes as sc (sc.code)}
					<li
						class="flex flex-col items-center gap-2 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] p-4"
					>
						<img
							src={`/sites/${data.site.site_id}/qr/${sc.code}`}
							alt={`QR code ${sc.code}`}
							class="h-40 w-40"
						/>
						<code class="text-xs">{sc.code}</code>
						<span class="text-xs text-[color-mix(in_oklch,var(--foreground)_55%,transparent)]">
							→ {sc.target_path}
						</span>
						<div class="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-xs">
							<a
								href={`/sites/${data.site.site_id}/qr/${sc.code}`}
								download={`${sc.code}.svg`}
								class="underline"
							>
								{m.qr_download_svg()}
							</a>
							<a
								href={`/sites/${data.site.site_id}/qr/${sc.code}?format=pdf&size=card`}
								download={`${sc.code}-card.pdf`}
								class="underline"
							>
								{m.qr_download_pdf_card()}
							</a>
							<a
								href={`/sites/${data.site.site_id}/qr/${sc.code}?format=pdf&size=plaque`}
								download={`${sc.code}-plaque.pdf`}
								class="underline"
							>
								{m.qr_download_pdf_plaque()}
							</a>
							<a
								href={`/sites/${data.site.site_id}/qr/${sc.code}?format=pdf&size=headstone`}
								download={`${sc.code}-headstone.pdf`}
								class="underline"
							>
								{m.qr_download_pdf_headstone()}
							</a>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
