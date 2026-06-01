/**
 * Client-side helper: open a per-document Automerge handle and
 * attach it to a svedit `Session` so local ops mirror into the
 * doc and remote peers' changes flow back into the rendered
 * state. Shares the per-site `Repo` singleton with the tree /
 * page-broadcast subscriptions (one WebSocket connection per
 * site, not per document).
 *
 * Returns a cleanup function the caller invokes when the session
 * is replaced (e.g. on navigation to a different page).
 */

import { browser } from '$app/environment';
import type { AutomergeUrl } from '@automerge/automerge-repo';

interface SessionLike {
	attach_automerge_handle: (handle: unknown, splice?: SpliceFn) => void;
	detach_automerge_handle: () => void;
}

type SpliceFn = (
	doc: unknown,
	path: ReadonlyArray<string | number>,
	index: number,
	deleteCount: number,
	value?: string
) => void;

interface RepoLike {
	find: <T>(url: AutomergeUrl) => Promise<{
		change: (fn: (d: T) => void) => void;
		doc: () => T | undefined;
		on: (event: 'change', fn: () => void) => void;
		off: (event: 'change', fn: () => void) => void;
	}>;
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
		storage: new IndexedDBStorageAdapter('memoriam-documents')
	}) as unknown as RepoLike;
	currentSiteId = siteId;
	return repoSingleton;
}

/**
 * Attach an Automerge doc to the session. Returns a cleanup that
 * detaches when the session is replaced. Failures are caught — the
 * editor still works without sync; multiplayer just goes inactive.
 */
export function attachSessionToDocumentDoc(
	siteId: string,
	docUrl: string,
	session: SessionLike
): () => void {
	if (!browser) return () => undefined;

	let cancelled = false;
	let attached_handle: { off?: () => void } | null = null;

	(async () => {
		try {
			const [{ isValidAutomergeUrl }, automerge] = await Promise.all([
				import('@automerge/automerge-repo'),
				import('@automerge/automerge')
			]);
			if (!isValidAutomergeUrl(docUrl)) return;
			const repo = await getRepo(siteId);
			const handle = await repo.find(docUrl as AutomergeUrl);
			if (cancelled) return;
			// `Automerge.splice` is the per-character CRDT op; passing
			// it through lets Session route text edits in
			// `annotated_text` properties through splice instead of
			// whole-value replace. Concurrent typing in the same
			// paragraph merges character-by-character.
			session.attach_automerge_handle(
				handle,
				automerge.splice as unknown as SpliceFn
			);
			attached_handle = handle as unknown as { off?: () => void };
		} catch (err) {
			console.error('[automerge] session attach failed', err);
		}
	})();

	return () => {
		cancelled = true;
		try {
			session.detach_automerge_handle();
		} catch (err) {
			console.error('[automerge] session detach failed', err);
		}
		attached_handle = null;
	};
}
