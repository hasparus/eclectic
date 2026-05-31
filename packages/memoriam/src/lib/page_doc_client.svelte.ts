/**
 * Client-side helper: subscribe to a per-site Automerge "broadcast"
 * doc and fire a callback whenever it changes. The doc itself can
 * be anything — we don't read its fields, just observe that *some*
 * field shifted.
 *
 * Used for the page-edit broadcast channel (a tiny doc holding just
 * `{ site_id, updated_at }`) where the only meaningful event is
 * "someone saved a page on this site". The callback is typically
 * `invalidateAll` so the page reloads against the new SQLite state.
 *
 * Shares the per-page-session `Repo` singleton with
 * `tree_doc_client` (same site, same WebSocket connection).
 */

import { browser } from '$app/environment';
import { onDestroy } from 'svelte';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';

interface RepoLike {
	find: <T>(url: AutomergeUrl) => Promise<DocHandle<T>>;
	shutdown: () => Promise<void>;
}

let repoSingleton: RepoLike | null = null;
let currentSiteId: string | null = null;

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
		storage: new IndexedDBStorageAdapter('memoriam-pages')
	}) as RepoLike;
	currentSiteId = siteId;
	return repoSingleton;
}

/**
 * Subscribe to a broadcast doc. `onChange` fires once per change
 * event, debounced 300ms — that absorbs the local-save echo so a
 * tab doesn't trigger its own follow-up invalidation.
 */
export function subscribeToPageBroadcast(
	siteId: string,
	docUrl: string,
	onChange: () => void
): void {
	if (!browser) return;

	let off: (() => void) | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let initialised = false;

	(async () => {
		const { isValidAutomergeUrl } = await import('@automerge/automerge-repo');
		if (!isValidAutomergeUrl(docUrl)) return;
		const repo = await getRepo(siteId);
		const handle = await repo.find(docUrl as AutomergeUrl);
		const fire = () => {
			// Skip the first synthetic change that fires when the
			// handle becomes ready — we only care about real
			// post-mount mutations.
			if (!initialised) {
				initialised = true;
				return;
			}
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				debounce = null;
				onChange();
			}, 300);
		};
		fire(); // marks initialised
		handle.on('change', fire);
		off = () => handle.off('change', fire);
	})().catch((err) => {
		console.error('[automerge] subscribeToPageBroadcast failed', err);
	});

	onDestroy(() => {
		off?.();
		if (debounce) clearTimeout(debounce);
	});
}
