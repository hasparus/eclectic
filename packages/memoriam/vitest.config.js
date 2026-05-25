import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.js'],
		environment: 'node',
		// Tests open many SQLite files; run them serially so the per-site
		// LRU cache doesn't get accidentally shared across parallel suites.
		fileParallelism: false
	},
	resolve: {
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname
		}
	}
});
