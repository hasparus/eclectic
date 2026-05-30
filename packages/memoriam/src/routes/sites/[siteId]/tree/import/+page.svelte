<script lang="ts">
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';
	import { parseGedcom, reduceGedcom, type ParsedGedcom } from '$lib/gedcom';

	interface Props {
		data: { site: { site_id: string; display_name: string | null } };
	}
	let { data }: Props = $props();

	let parseError = $state('');
	let parsed = $state<ParsedGedcom | null>(null);
	let filename = $state('');
	let importPending = $state(false);
	let importError = $state('');
	let importResult = $state<{
		people_created: number;
		parent_edges_created: number;
		couples_created: number;
		skipped: string[];
	} | null>(null);

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		filename = file.name;
		parseError = '';
		parsed = null;
		importResult = null;
		try {
			const text = await file.text();
			const reduced = reduceGedcom(parseGedcom(text));
			if (reduced.individuals.length === 0) {
				parseError = m.tree_import_parse_error();
				return;
			}
			parsed = reduced;
		} catch {
			parseError = m.tree_import_parse_error();
		}
	}

	function reset() {
		parsed = null;
		filename = '';
		parseError = '';
		importResult = null;
		importError = '';
	}

	async function runImport() {
		if (!parsed || importPending) return;
		importPending = true;
		importError = '';
		try {
			const api = await import('$lib/api.remote.js');
			const r = (await api.importGedcom({
				site_id: data.site.site_id,
				parsed
			})) as
				| {
						ok: true;
						result: {
							people_created: number;
							parent_edges_created: number;
							couples_created: number;
							skipped: string[];
						};
				  }
				| { ok: false; code: string; message: string };
			if (r.ok === false) {
				importError = r.message;
				return;
			}
			importResult = r.result;
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			importPending = false;
		}
	}
</script>

<svelte:head><title>{m.tree_import_heading()}</title></svelte:head>

<main class="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-8 text-(--foreground)">
	<header class="flex flex-col gap-1">
		<a
			href={`/sites/${data.site.site_id}/tree`}
			class="text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)] underline"
		>
			← {m.tree_back_to_site()}
		</a>
		<h1 class="m-0 text-2xl font-medium">{m.tree_import_heading()}</h1>
		<p class="m-0 text-sm text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
			{m.tree_import_body()}
		</p>
	</header>

	{#if importResult}
		<section
			class="flex flex-col gap-3 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] p-4"
			role="status"
			aria-live="polite"
		>
			<p class="m-0 text-sm">
				{m.tree_import_success({
					people: importResult.people_created,
					edges: importResult.parent_edges_created,
					couples: importResult.couples_created,
					skipped: importResult.skipped.length
				})}
			</p>
			{#if importResult.skipped.length > 0}
				<details>
					<summary class="cursor-pointer text-xs">
						{importResult.skipped.length} skipped
					</summary>
					<ul class="m-0 mt-2 list-disc pl-5 text-xs">
						{#each importResult.skipped as line, i (i)}
							<li class="font-mono">{line}</li>
						{/each}
					</ul>
				</details>
			{/if}
			<a
				href={`/sites/${data.site.site_id}/tree`}
				class="self-start border border-(--svedit-editing-stroke) bg-(--background) px-3 py-1.5 text-xs font-semibold text-(--svedit-editing-stroke)"
			>
				{m.tree_import_back_to_tree()}
			</a>
		</section>
	{:else if parsed}
		<section
			class="flex flex-col gap-3 border border-[color-mix(in_oklch,var(--foreground)_15%,transparent)] p-4"
		>
			<h2 class="m-0 text-base font-medium">{m.tree_import_preview_heading()}</h2>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
					{m.tree_import_file_label()}
				</dt>
				<dd class="font-mono text-xs">{filename}</dd>
				<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
					{m.tree_import_preview_people({ count: parsed.individuals.length })}
				</dt>
				<dd></dd>
				<dt class="text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
					{m.tree_import_preview_families({ count: parsed.families.length })}
				</dt>
				<dd></dd>
			</dl>

			{#if importError}
				<p class="m-0 text-xs text-red-600" role="alert">{importError}</p>
			{/if}

			<div class="flex justify-end gap-3">
				<button
					type="button"
					class="text-xs underline"
					onclick={reset}
					disabled={importPending}
				>
					{m.tree_import_cancel()}
				</button>
				<button
					type="button"
					onclick={() => void runImport()}
					disabled={importPending}
					class="border border-(--svedit-editing-stroke) bg-(--background) px-3 py-1.5 text-xs font-semibold text-(--svedit-editing-stroke) disabled:opacity-50"
				>
					{importPending ? m.tree_import_pending() : m.tree_import_confirm()}
				</button>
			</div>
		</section>
	{:else}
		<section class="flex flex-col gap-3">
			<label class="flex flex-col gap-2 text-sm">
				<span>{m.tree_import_file_label()}</span>
				<input
					type="file"
					accept=".ged,.gedcom,text/plain"
					onchange={onFile}
					class="text-sm"
				/>
			</label>
			{#if parseError}
				<p class="m-0 text-xs text-red-600" role="alert">{parseError}</p>
			{/if}
		</section>
	{/if}
</main>
