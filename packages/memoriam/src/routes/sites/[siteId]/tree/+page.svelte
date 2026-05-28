<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { layoutTree, formatLifespan, CARD_WIDTH, CARD_HEIGHT } from '$lib/tree_layout';
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

	// `layout` is a pure derivation from the tree payload — d3-dag's
	// Sugiyama call is cheap (n ≤ ~50 in practice) and re-running it
	// on data changes keeps the canvas in sync after edits.
	let layout = $derived(data.tree ? layoutTree(data.tree) : null);

	let selectedId = $state<string | null>(null);
	let selected = $derived.by(() => {
		if (!selectedId || !layout) return null;
		return layout.nodes.find((n) => n.id === selectedId)?.person ?? null;
	});

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
			// 1. Create the new person, linked to this site.
			const personResult = (await api.createPerson({
				site_id: data.site.site_id,
				display_name: name,
				sex: addSex === 'U' ? null : addSex,
				birth_date: addBirthDate || null,
				death_date: addDeathDate || null
			})) as
				| { ok: true; person: Person }
				| { ok: false; code: string; message: string };
			if (personResult.ok === false) {
				addError = personResult.message;
				return;
			}
			const newPerson = personResult.person;

			// 2. Wire up the relationship to the anchor.
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

	// "Set subject" pending state.
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

	// Inline edit form for the selected person.
	let editPending = $state(false);
	let editError = $state('');

	async function saveSelected(formData: FormData) {
		if (!selected || editPending) return;
		editPending = true;
		editError = '';
		try {
			const api = await import('$lib/api.remote.js');
			const result = (await api.updatePerson({
				person_id: selected.person_id,
				display_name: String(formData.get('display_name') || selected.display_name),
				given_names: stringOrNull(formData.get('given_names')),
				surname: stringOrNull(formData.get('surname')),
				sex: ((formData.get('sex') as string) || 'U') === 'U' ? null : (formData.get('sex') as Sex),
				birth_date: stringOrNull(formData.get('birth_date')),
				birth_place: stringOrNull(formData.get('birth_place')),
				death_date: stringOrNull(formData.get('death_date')),
				death_place: stringOrNull(formData.get('death_place')),
				is_living: formData.get('is_living') === 'on',
				biography: stringOrNull(formData.get('biography'))
			})) as
				| { ok: true; person: Person }
				| { ok: false; code: string; message: string };
			if (result.ok === false) {
				editError = result.message;
				return;
			}
			await invalidateAll();
		} catch (err) {
			editError = err instanceof Error ? err.message : m.tree_save_error();
		} finally {
			editPending = false;
		}
	}

	function stringOrNull(v: FormDataEntryValue | null): string | null {
		if (v === null) return null;
		const s = String(v).trim();
		return s ? s : null;
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
		<!-- No subject yet — prompt to seed one from the site display name. -->
		<section
			class="flex flex-col items-center gap-3 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] px-6 py-12 text-center"
		>
			<h2 class="m-0 text-lg font-medium">{m.tree_no_subject_heading()}</h2>
			<p
				class="m-0 max-w-prose text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]"
			>
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
			<!-- Tree canvas. -->
			<div class="flex-1 overflow-auto border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] p-4">
				<svg
					data-testid="tree-canvas"
					viewBox={`0 0 ${Math.max(layout.width, 400)} ${Math.max(layout.height, 200)}`}
					class="block h-auto w-full"
					role="figure"
					aria-label={m.tree_page_title()}
				>
					<!-- Parent → child edges first so cards sit on top. -->
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

					<!-- Couple links. -->
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

					<!-- Person cards. -->
					{#each layout.nodes as node (node.id)}
						{@const lifespan = formatLifespan(node.person)}
						{@const isSubject = node.id === data.subject.person_id}
						{@const isSelected = node.id === selectedId}
						<g transform={`translate(${node.x - CARD_WIDTH / 2}, ${node.y - CARD_HEIGHT / 2})`}>
							<rect
								data-testid="tree-card"
								data-person-id={node.id}
								x="0"
								y="0"
								width={CARD_WIDTH}
								height={CARD_HEIGHT}
								rx="6"
								class="cursor-pointer fill-(--background) stroke-current"
								class:stroke-2={isSelected || isSubject}
								stroke="currentColor"
								onclick={() => (selectedId = node.id)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										selectedId = node.id;
									}
								}}
								role="button"
								tabindex="0"
								aria-label={node.person.display_name}
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
				</svg>
			</div>

			<!-- Side drawer. -->
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
							onclick={() => (selectedId = null)}
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
								void saveSelected(new FormData(e.currentTarget));
							}}
						>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_display_name()}
								</span>
								<input
									name="display_name"
									value={sel.display_name}
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
										name="given_names"
										value={sel.given_names ?? ''}
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
									/>
								</label>
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_surname()}
									</span>
									<input
										name="surname"
										value={sel.surname ?? ''}
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
									/>
								</label>
							</div>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_sex()}
								</span>
								<select
									name="sex"
									value={sel.sex ?? 'U'}
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
										name="birth_date"
										value={sel.birth_date ?? ''}
										placeholder="YYYY-MM-DD"
										class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1 font-mono text-[12px]"
									/>
								</label>
								<label class="flex flex-col gap-0.5 text-xs">
									<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
										{m.tree_field_death_date()}
									</span>
									<input
										name="death_date"
										value={sel.death_date ?? ''}
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
									name="birth_place"
									value={sel.birth_place ?? ''}
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								/>
							</label>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_death_place()}
								</span>
								<input
									name="death_place"
									value={sel.death_place ?? ''}
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								/>
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									name="is_living"
									checked={sel.is_living === 1}
								/>
								{m.tree_field_is_living()}
							</label>
							<label class="flex flex-col gap-0.5 text-xs">
								<span class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
									{m.tree_field_biography()}
								</span>
								<textarea
									name="biography"
									value={sel.biography ?? ''}
									rows="3"
									class="border border-[color-mix(in_oklch,var(--foreground)_18%,transparent)] bg-(--background) px-2 py-1"
								></textarea>
							</label>
							<button
								type="submit"
								disabled={editPending}
								class="self-start border border-(--svedit-editing-stroke) bg-(--background) px-3 py-1 text-xs font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
							>
								{editPending ? m.tree_save_pending() : m.tree_save()}
							</button>
							{#if editError}
								<p class="m-0 text-xs text-red-600">{editError}</p>
							{/if}
						</form>
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
		<!-- Lightweight modal overlay; covers the page; click outside cancels. -->
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
