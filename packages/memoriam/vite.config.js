import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { automergeSyncPlugin } from './vite-plugin-automerge.js';

export default defineConfig({
	plugins: [
		// `wasm` + `topLevelAwait` let `@automerge/automerge` load
		// its WASM binary via ES module imports; without them Vite's
		// SSR loader throws "ESM Wasm integration proposal not
		// supported."
		wasm(),
		topLevelAwait(),
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' }),
		automergeSyncPlugin()
	],
	optimizeDeps: {
		exclude: ['@jsquash/webp', '@automerge/automerge'],
		// Force CJS-shaped Automerge deps through Vite's
		// optimisation step so their default + named exports work
		// in the browser. Without these every dependent named
		// import (`{ EventEmitter }`, `{ sha256 }`, etc.) fails at
		// runtime with "does not provide an export named 'default'".
		include: [
			'@automerge/automerge-repo',
			'@automerge/automerge-repo-network-websocket',
			'@automerge/automerge-repo-storage-indexeddb',
			'eventemitter3',
			'bs58check',
			'bs58',
			'debug',
			'uuid',
			'@noble/hashes/sha256',
			'@noble/hashes/utils'
		],
		esbuildOptions: {
			// bs58check + @noble/hashes do CJS-style destructuring
			// from packages that Vite considers ESM. Letting esbuild
			// treat them as mixed lets the interop just work.
			mainFields: ['module', 'main']
		}
	},
	worker: {
		format: 'es'
	}
});
