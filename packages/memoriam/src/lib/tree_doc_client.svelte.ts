/**
 * Client-side helper: subscribe to a per-site tree document over
 * WebSocket and expose a Svelte 5 `$state`-friendly view of the
 * current doc.
 *
 * Every Automerge dependency is dynamically imported — Automerge's
 * core ships a WASM binary that Vite's SSR loader can't handle
 * during page render. Lazy imports gate everything behind a
 * `browser` check so the server-render path never reaches the
 * WASM module.
 */

import { browser } from '$app/environment';
import { onDestroy } from 'svelte';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { TreeDoc } from '$lib/tree_doc.js';

interface RepoLike {
	find: <T>(url: AutomergeUrl) => Promise<DocHandle<T>>;
	shutdown: () => Promise<void>;
}

let repoSingleton: RepoLike | null = null;
let currentSiteId: string | null = null;

/**
 * Lazy-init the repo on first call. All `@automerge/...` imports
 * are dynamic so the SSR pass (which compiles `*.svelte.ts`
 * files) never sees them.
 */
async function getRepo(siteId: string): Promise<RepoLike> {
	if (repoSingleton && currentSiteId === siteId) return repoSingleton;
	if (repoSingleton) {
		await repoSingleton.shutdown();
		repoSingleton = null;
	}
	const [{ Repo }, { WebSocketClientAdapter }, { IndexedDBStorageAdapter }] = await Promise.all([
		import('@automerge/automerge-repo'),
		import('@automerge/automerge-repo-network-websocket'),
		import('@automerge/automerge-repo-storage-indexeddb')
	]);
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	const url = `${proto}//${location.host}/ws/automerge?site=${encodeURIComponent(siteId)}`;
	repoSingleton = new Repo({
		network: [new WebSocketClientAdapter(url)],
		storage: new IndexedDBStorageAdapter('memoriam-tree')
	}) as RepoLike;
	currentSiteId = siteId;
	return repoSingleton;
}

/**
 * Resolve a doc by URL, returning a reactive `$state` wrapper that
 * tracks the latest doc value. `state.doc` is the current snapshot;
 * `state.handle` is the underlying handle for callers that want to
 * commit changes via `handle.change()`.
 *
 * The first `repo.find()` is async — it resolves once storage
 * hydration and the first sync round-trip complete — so the wrapper
 * starts with `doc: null` and fills in when ready. The `change`
 * subscription is torn down on component destroy.
 */
export function subscribeToTreeDoc(siteId: string, docUrl: string) {
	const state = $state({ doc: null as TreeDoc | null, handle: null as DocHandle<TreeDoc> | null });
	if (!browser) return state;

	let off: (() => void) | null = null;

	(async () => {
		const { isValidAutomergeUrl } = await import('@automerge/automerge-repo');
		if (!isValidAutomergeUrl(docUrl)) return;
		const repo = await getRepo(siteId);
		const handle = await repo.find<TreeDoc>(docUrl as AutomergeUrl);
		state.handle = handle;
		const update = () => {
			const doc = handle.doc();
			if (doc) state.doc = doc;
		};
		update();
		handle.on('change', update);
		off = () => handle.off('change', update);
	})().catch((err) => {
		console.error('[automerge] subscribeToTreeDoc failed', err);
	});

	onDestroy(() => {
		off?.();
	});

	return state;
}
