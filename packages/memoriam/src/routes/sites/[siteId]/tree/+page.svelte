<script lang="ts">
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import { layoutTree, formatLifespan, CARD_WIDTH, CARD_HEIGHT } from '$lib/tree_layout';
	import { treeZoom } from '$lib/tree_zoom.svelte';
	import type { Person, Sex, ParentKind, TreePayload } from '$lib/people_types';

	function truncate(s: string, max: number): string {
		return s.length > max ? `${s.slice(0, max - 1)}…` : s;
	}

	interface Props {
		data: {
			site: { site_id: string; display_name: string | null };
			current_user_role: 'owner' | 'editor' | 'viewer';
			can_edit: boolean;
			subject: Person | null;
			tree: TreePayload | null;
		};
	}
	let { data }: Props = $props();

	let layout = $derived(data.tree ? layoutTree(data.tree) : null);

	// Selection lives in local `$state` so it's the source of reactive
	// truth for the drawer. The URL (`?focus=<person_id>`) is a
	// one-way mirror — written when selection changes so refresh /
	// share work, seeded from the URL on initial mount.
	// `replaceState` doesn't update `page.url` reactively, so we
	// can't `$derived` straight from the URL.
	let selectedId = $state<string | null>(page.url.searchParams.get('focus'));
	let selected = $derived.by(() => {
		if (!selectedId || !layout) return null;
		return layout.nodes.find((n) => n.id === selectedId)?.person ?? null;
	});

	function selectPerson(id: string | null) {
		selectedId = id;
		// Mirror selection into the URL on click. `replaceState` avoids
		// pushing a history entry per card tap — back returns to
		// `/sites/[id]` instead of cycling every selection.
		const url = new URL(page.url);
		if (id) url.searchParams.set('focus', id);
		else url.searchParams.delete('focus');
		replaceState(url, page.state);
	}

	// "Add" modal state.
	type AddMode = 'parent' | 'spouse' | 'child';
	let addOpen = $state(false);
	let addMode = $state<AddMode>('parent');
	let addAnchor = $state<Person | null>(null);
	let addDisplayName = $state('');
	let addBirthDate = $state('');
	let addDeathDate = $state('');
	let addSex = $state<Sex>('U');
	let addKind = $state<ParentKind>('biological');
	let addPending = $state(false);
	let addError = $state('');

	function openAdd(mode: AddMode, anchor: Person) {
		addMode = mode;
		addAnchor = anchor;
		addDisplayName = '';
		addBirthDate = '';
		addDeathDate = '';
		addSex = 'U';
		addKind = 'biological';
		addError = '';
		addOpen = true;
	}

	function closeAdd() {
		addOpen = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (addOpen) {
				closeAdd();
				event.preventDefault();
			} else if (selectedId) {
				selectPerson(null);
				event.preventDefault();
			}
		}
	}

	async function submitAdd() {
		if (addPending || !addAnchor) return;
		const name = addDisplayName.trim();
		if (!name) {
			addError = 'Display name is required.';
			return;
		}
		addPending = true;
		addError = '';
		try {
			const api = await import('$lib/api.remote.js');
			const personResult = (await api.createPerson({
				site_id: data.site.site_id,
				display_name: name,
				sex: addSex === 'U' ? null : addSex,
				birth_date: addBirthDate || null,
				death_date: addDeathDate || null
			})) as { ok: true; person: Person } | { ok: false; code: string; message: string };
			if (personResult.ok === false) {
				addError = personResult.message;
				return;
			}
			const newPerson = personResult.person;

			if (addMode === 'parent') {
				await api.addParentEdge({
					parent_id: newPerson.person_id,
					child_id: addAnchor.person_id,
					kind: addKind,
					site_id: data.site.site_id
				});
			} else if (addMode === 'child') {
				await api.addParentEdge({
					parent_id: addAnchor.person_id,
					child_id: newPerson.person_id,
					kind: addKind,
					site_id: data.site.site_id
				});
			} else {
				await api.addCouple({
					person_a_id: addAnchor.person_id,
					person_b_id: newPerson.person_id,
					site_id: data.site.site_id
				});
			}

			addOpen = false;
			await invalidateAll();
		} catch (err) {
			addError = err instanceof Error ? err.message : 'Could not add.';
		} finally {
			addPending = false;
		}
	}

	let subjectPending = $state(false);
	async function setSubjectFromSiteName() {
		if (subjectPending) return;
		subjectPending = true;
		try {
			const api = await import('$lib/api.remote.js');
			const name = data.site.display_name?.trim() || 'Subject';
			const result = (await api.createPerson({
				site_id: data.site.site_id,
				display_name: name
			})) as { ok: true; person: Person } | { ok: false; code: string; message: string };
			if (result.ok === false) return;
			await api.setSiteSubject({
				site_id: data.site.site_id,
				person_id: result.person.person_id
			});
			await invalidateAll();
		} finally {
			subjectPending = false;
		}
	}

	// Controlled edit form. Fields shadow the selected person; the
	// effect below syncs them when the selection changes. Going
	// controlled also lets us auto-toggle `is_living` based on
	// `death_date` — the previous uncontrolled FormData approach left
	// `Living` checked even after a death date was filled.
	let editFields = $state({
		display_name: '',
		given_names: '',
		surname: '',
		sex: 'U' as Sex,
		birth_date: '',
		birth_place: '',
		death_date: '',
		death_place: '',
		is_living: false,
		biography: ''
	});
	let editSeededFor = $state<string | null>(null);
	let editPending = $state(false);
	let editError = $state('');

	$effect(() => {
		// Seed the form whenever the selected person changes (by id).
		// `editSeededFor` guards against the effect re-running while
		// the user is mid-edit on the same person.
		if (!selected) {
			editSeededFor = null;
			return;
		}
		if (selected.person_id === editSeededFor) return;
		editFields = {
			display_name: selected.display_name,
			given_names: selected.given_names ?? '',
			surname: selected.surname ?? '',
			sex: (selected.sex ?? 'U') as Sex,
			birth_date: selected.birth_date ?? '',
			birth_place: selected.birth_place ?? '',
			death_date: selected.death_date ?? '',
			death_place: selected.death_place ?? '',
			is_living: selected.is_living === 1,
			biography: selected.biography ?? ''
		};
		editSeededFor = selected.person_id;
		editError = '';
	});

	// Auto-toggle: filling in a death date implies the person is no
	// longer living. Clearing the death date alone doesn't flip them
	// back to living (the user has to opt in explicitly via the
	// checkbox) — that's safer than guessing intent.
	$effect(() => {
		if (editFields.death_date.trim()) {
			if (editFields.is_living) editFields.is_living = false;
		}
	});

	async function saveSelected() {
		if (!selected || editPending) return;
		editPending = true;
		editError = '';
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.updatePerson({
				person_id: selected.person_id,
				display_name: editFields.display_name,
				given_names: editFields.given_names || null,
				surname: editFields.surname || null,
				sex: editFields.sex === 'U' ? null : editFields.sex,
				birth_date: editFields.birth_date || null,
				birth_place: editFields.birth_place || null,
				death_date: editFields.death_date || null,
				death_place: editFields.death_place || null,
				is_living: editFields.is_living,
				biography: editFields.biography || null
			})) as { ok: true; person: Person } | { ok: false; code: string; message: string };
			if (result.ok === false) {
				editError = result.message;
				return;
			}
			flashSaved();
			// Re-seed once the load returns so any normalisations
			// (year columns recomputed) flow back into the form.
			editSeededFor = null;
			await invalidateAll();
		} catch (err) {
			editError = err instanceof Error ? err.message : m.tree_save_error();
		} finally {
			editPending = false;
		}
	}

	let showSaved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | null = null;
	function flashSaved() {
		showSaved = true;
		if (savedTimer) clearTimeout(savedTimer);
		savedTimer = setTimeout(() => {
			showSaved = false;
			savedTimer = null;
		}, 2500);
	}

	let deletePending = $state(false);
	async function deleteSelected() {
		if (!selected || deletePending) return;
		if (!confirm(m.tree_delete_confirm({ name: selected.display_name }))) return;
		deletePending = true;
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.deletePerson({ person_id: selected.person_id })) as
				| { ok: true }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				editError = result.message;
				return;
			}
			selectPerson(null);
			await invalidateAll();
		} finally {
			deletePending = false;
		}
	}

	function sexLabel(s: Sex | null): string {
		switch (s) {
			case 'M':
				return m.tree_field_sex_male();
			case 'F':
				return m.tree_field_sex_female();
			case 'X':
				return m.tree_field_sex_other();
			default:
				return m.tree_field_sex_unknown();
		}
	}

</script>

<svelte:head><title>{m.tree_page_title()}</title></svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<main class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-(--foreground)">
	<header class="flex items-baseline justify-between gap-4">
		<div class="flex flex-col gap-1">
			<a
				href="/sites/{data.site.site_id}"
				class="text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)] underline"
			>
				{m.tree_back_to_site()}
			</a>
			<h1 class="m-0 text-2xl font-medium">{m.tree_page_title()}</h1>
			{#if data.subject}
				<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
					{m.tree_subject_heading({ name: data.subject.display_name })}
				</p>
			{/if}
		</div>
	</header>

	{#if !data.subject}
		<section
			class="flex flex-col items-center gap-3 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] px-6 py-12 text-center"
		>
			<h2 class="m-0 text-lg font-medium">{m.tree_no_subject_heading()}</h2>
			<p class="m-0 max-w-prose text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
				{m.tree_no_subject_body()}
			</p>
			{#if data.can_edit}
				<button
					type="button"
					onclick={() => void setSubjectFromSiteName()}
					disabled={subjectPending}
					class="border border-(--svedit-editing-stroke) bg-(--background) px-4 py-2 text-sm font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
				>
					{subjectPending
						? m.tree_no_subject_pending()
						: data.site.display_name
							? m.tree_no_subject_set_button({ name: data.site.display_name })
							: m.tree_no_subject_set_button_generic()}
				</button>
			{/if}
		</section>
	{:else if layout && layout.nodes.length > 0}
		<div class="flex flex-1 gap-4">
			<div class="relative flex-1 overflow-hidden border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)]">
				<svg
					use:treeZoom
					viewBox={`0 0 ${Math.max(layout.width, 400)} ${Math.max(layout.height, 200)}`}
					class="block h-[60vh] w-full cursor-grab active:cursor-grabbing"
					role="figure"
					aria-label={m.tree_page_title()}
				>
					<!-- The zoomable group is what the action transforms.
					     Everything that pans/zooms with the canvas lives
					     inside it. -->
					<g class="zoomable">
						<g class="text-[color-mix(in_oklch,var(--foreground)_30%,transparent)]">
							{#each layout.edges as edge (`${edge.from}-${edge.to}`)}
								<path
									d={`M ${edge.from_xy[0]} ${edge.from_xy[1] + CARD_HEIGHT / 2}
									   C ${edge.from_xy[0]} ${(edge.from_xy[1] + edge.to_xy[1]) / 2 + CARD_HEIGHT / 2},
									     ${edge.to_xy[0]} ${(edge.from_xy[1] + edge.to_xy[1]) / 2 - CARD_HEIGHT / 2},
									     ${edge.to_xy[0]} ${edge.to_xy[1] - CARD_HEIGHT / 2}`}
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									class:stroke-dashed={edge.kind !== 'biological'}
								/>
							{/each}
						</g>

						<g class="text-[color-mix(in_oklch,var(--foreground)_45%,transparent)]">
							{#each layout.couples as couple (couple.couple_id)}
								<line
									x1={couple.a_xy[0]}
									y1={couple.a_xy[1]}
									x2={couple.b_xy[0]}
									y2={couple.b_xy[1]}
									stroke="currentColor"
									stroke-width="1"
									stroke-dasharray="4 4"
								/>
							{/each}
						</g>

						{#each layout.nodes as node (node.id)}
							{@const lifespan = formatLifespan(node.person)}
							{@const isSubject = node.id === data.subject.person_id}
							{@const isSelected = node.id === selectedId}
							<g transform={`translate(${node.x - CARD_WIDTH / 2}, ${node.y - CARD_HEIGHT / 2})`}>
								<rect
									x="0"
									y="0"
									width={CARD_WIDTH}
									height={CARD_HEIGHT}
									rx="6"
									class="cursor-pointer fill-(--background) stroke-current"
									class:stroke-2={isSelected || isSubject}
									stroke="currentColor"
									onclick={() => selectPerson(node.id)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectPerson(node.id);
										}
									}}
									role="button"
									tabindex="0"
									aria-label={lifespan
										? `${node.person.display_name}, ${lifespan}`
										: node.person.display_name}
								/>
								<text
									x={CARD_WIDTH / 2}
									y={lifespan ? 22 : 28}
									text-anchor="middle"
									class="pointer-events-none select-none fill-current text-[13px] font-medium"
								>
									{truncate(node.person.display_name, 22)}
								</text>
								{#if lifespan}
									<text
										x={CARD_WIDTH / 2}
										y="44"
										text-anchor="middle"
										class="pointer-events-none select-none fill-[color-mix(in_oklch,currentColor_60%,transparent)] text-[11px]"
									>
										{lifespan}
									</text>
								{/if}
							</g>
						{/each}
					</g>
				</svg>
			</div>

			{#if selected}
				{@const sel = selected}
				<aside
					class="flex w-80 flex-col gap-3 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] p-4 text-sm"
					aria-label={m.tree_drawer_title()}
				>
					<div class="flex items-baseline justify-between">
						<h2 class="m-0 text-base font-medium">{sel.display_name}</h2>
						<button
							type="button"
							class="text-xs underline"
							onclick={() => selectPerson(null)}
						>
							{m.tree_drawer_close()}
						</button>
					</div>

					{#if data.can_edit}
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								class="border border-[color-mix(in_oklch,var(--foreground)_25%,transparent)] px-2 py-1 text-xs"
								onclick={() => openAdd('parent', sel)}
							>
								{m.tree_add_parent()}
							</button>
							<button
								type="button"
								class="border border-[color-mix(in_oklch,var(--foreground)_25%,transparent)] px-2 py-1 text-xs"
								onclick={() => openAdd('spouse', sel)}
							>
								{m.tree_add_spouse()}
							</button>
							<button
								type="button"
								class="border border-[color-mix(in_oklch,var(--foreground)_25%,transparent)] px-2 py-1 text-xs"
								onclick={() => openAdd('child', sel)}
							>
								{m.tree_add_child()}
							</button>
						</div>

						<form
							class="flex flex-col gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void saveSelected();
							}}
						>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_display_name()}
								</span>
								<input
									bind:value={editFields.display_name}
									required
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								/>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_given_names()}
									</span>
									<input
										bind:value={editFields.given_names}
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
									/>
								</label>
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_surname()}
									</span>
									<input
										bind:value={editFields.surname}
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
									/>
								</label>
							</div>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_sex()}
								</span>
								<select
									bind:value={editFields.sex}
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								>
									<option value="U">{m.tree_field_sex_unknown()}</option>
									<option value="F">{m.tree_field_sex_female()}</option>
									<option value="M">{m.tree_field_sex_male()}</option>
									<option value="X">{m.tree_field_sex_other()}</option>
								</select>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_birth_date()}
									</span>
									<input
										bind:value={editFields.birth_date}
										placeholder="YYYY-MM-DD"
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1 font-mono text-[12px]"
									/>
								</label>
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_death_date()}
									</span>
									<input
										bind:value={editFields.death_date}
										placeholder="YYYY-MM-DD"
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1 font-mono text-[12px]"
									/>
								</label>
							</div>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_birth_place()}
								</span>
								<input
									bind:value={editFields.birth_place}
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								/>
							</label>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_death_place()}
								</span>
								<input
									bind:value={editFields.death_place}
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								/>
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									bind:checked={editFields.is_living}
									aria-label={m.tree_field_is_living()}
								/>
								{m.tree_field_is_living()}
							</label>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_biography()}
								</span>
								<textarea
									bind:value={editFields.biography}
									rows="3"
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								></textarea>
							</label>
							<div class="flex items-center gap-3">
								<button
									type="submit"
									disabled={editPending}
									class="border border-(--svedit-editing-stroke) bg-(--background) px-3 py-1 text-xs font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
								>
									{editPending ? m.tree_save_pending() : m.tree_save()}
								</button>
								{#if showSaved}
									<span
										class="text-xs text-(--svedit-editing-stroke)"
										role="status"
										aria-live="polite"
									>
										{m.tree_saved_toast()}
									</span>
								{/if}
							</div>
							{#if editError}
								<p class="m-0 text-xs text-red-600" role="alert">{editError}</p>
							{/if}
						</form>

						<button
							type="button"
							onclick={() => void deleteSelected()}
							disabled={deletePending}
							class="self-start text-xs text-red-600 underline disabled:opacity-50"
						>
							{deletePending ? m.tree_delete_pending() : m.tree_delete_person()}
						</button>
					{:else}
						<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
							<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
								{m.tree_field_sex()}
							</dt>
							<dd>{sexLabel(sel.sex)}</dd>
							{#if sel.birth_date || sel.birth_place}
								<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_birth_date()}
								</dt>
								<dd>{sel.birth_date ?? ''} {sel.birth_place ? `· ${sel.birth_place}` : ''}</dd>
							{/if}
							{#if sel.death_date || sel.death_place}
								<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_death_date()}
								</dt>
								<dd>{sel.death_date ?? ''} {sel.death_place ? `· ${sel.death_place}` : ''}</dd>
							{/if}
						</dl>
					{/if}
				</aside>
			{/if}
		</div>
	{/if}

	{#if addOpen && addAnchor}
		{@const anchor = addAnchor}
		<div class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
			<div
				class="flex w-full max-w-sm flex-col gap-3 bg-(--background) p-4 text-sm"
				role="dialog"
				aria-modal="true"
				aria-label={anchor.display_name}
			>
				<h2 class="m-0 text-base font-medium">
					{addMode === 'parent'
						? m.tree_add_modal_parent_title({ name: anchor.display_name })
						: addMode === 'spouse'
							? m.tree_add_modal_spouse_title({ name: anchor.display_name })
							: m.tree_add_modal_child_title({ name: anchor.display_name })}
				</h2>
				<label class="flex flex-col gap-1 text-xs">
					<span>{m.tree_field_display_name()}</span>
					<input
						bind:value={addDisplayName}
						class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
						required
					/>
				</label>
				<div class="grid grid-cols-2 gap-2">
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.tree_field_birth_date()}</span>
						<input
							bind:value={addBirthDate}
							placeholder="YYYY"
							class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1 font-mono text-[12px]"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.tree_field_death_date()}</span>
						<input
							bind:value={addDeathDate}
							placeholder="YYYY"
							class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1 font-mono text-[12px]"
						/>
					</label>
				</div>
				<label class="flex flex-col gap-1 text-xs">
					<span>{m.tree_field_sex()}</span>
					<select
						bind:value={addSex}
						class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
					>
						<option value="U">{m.tree_field_sex_unknown()}</option>
						<option value="F">{m.tree_field_sex_female()}</option>
						<option value="M">{m.tree_field_sex_male()}</option>
						<option value="X">{m.tree_field_sex_other()}</option>
					</select>
				</label>
				{#if addMode !== 'spouse'}
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.tree_add_modal_kind_label()}</span>
						<select
							bind:value={addKind}
							class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
						>
							<option value="biological">{m.tree_add_modal_kind_biological()}</option>
							<option value="adoptive">{m.tree_add_modal_kind_adoptive()}</option>
							<option value="foster">{m.tree_add_modal_kind_foster()}</option>
							<option value="step">{m.tree_add_modal_kind_step()}</option>
						</select>
					</label>
				{/if}
				{#if addError}
					<p class="m-0 text-xs text-red-600">{addError}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<button
						type="button"
						class="text-xs underline"
						onclick={closeAdd}
						disabled={addPending}
					>
						{m.tree_add_modal_cancel()}
					</button>
					<button
						type="button"
						onclick={() => void submitAdd()}
						disabled={addPending}
						class="border border-(--svedit-editing-stroke) bg-(--background) px-3 py-1 text-xs font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
					>
						{addPending ? m.tree_add_modal_create_pending() : m.tree_add_modal_create_button()}
					</button>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.stroke-dashed {
		stroke-dasharray: 4 4;
	}
</style>
