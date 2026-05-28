<script lang="ts">
	import { getLocale, setLocale, locales } from '$lib/paraglide/runtime';

	// `locales` is a frozen array of supported BCP47 tags. Labels stay
	// inline (not in the message catalogue) so each language label is
	// always written in its own language — the universal way to do
	// language pickers.
	const labels: Record<string, string> = {
		en: 'English',
		pl: 'Polski'
	};

	let current = $derived(getLocale());

	function switchTo(next: string) {
		if (next === current) return;
		// Default behaviour: persist via the cookie strategy and reload
		// the page so server-rendered strings come back in the new locale.
		setLocale(next as (typeof locales)[number]);
	}
</script>

<div class="inline-flex items-baseline gap-1 text-xs text-[color-mix(in_oklch,var(--foreground)_60%,transparent)]">
	{#each locales as locale, i (locale)}
		{#if i > 0}
			<span aria-hidden="true">·</span>
		{/if}
		<button
			type="button"
			class="underline"
			class:font-medium={locale === current}
			class:no-underline={locale === current}
			aria-current={locale === current ? 'true' : undefined}
			onclick={() => switchTo(locale)}
		>
			{labels[locale] ?? locale}
		</button>
	{/each}
</div>
