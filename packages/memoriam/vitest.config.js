import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	test: {
		include: ['tests/**/*.test.js'],
		environment: 'node',
		// Server-only modules don't depend on Svelte components, but
		// migrations.js imports demo_doc.js which transitively imports
		// svedit. The svelte plugin lets the resolver follow svedit's
		// `svelte` export condition and the .svelte re-exports load
		// cleanly.
		server: {
			deps: {
				inline: ['svedit']
			}
		},
		// Tests open many SQLite files; run them serially so the per-site
		// LRU cache doesn't get accidentally shared across parallel suites.
		fileParallelism: false
	},
	resolve: {
		conditions: ['svelte', 'browser', 'import', 'default'],
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname,
			'$env/dynamic/private': new URL('./tests/stubs/sveltekit-env.js', import.meta.url).pathname
		}
	}
});
