/**
 * Server-side Automerge repo + per-site tree-doc bootstrapper.
 *
 * One process-wide `Repo` instance with:
 *   - NodeFS storage at `data/automerge/` (binary changes persist
 *     across restarts).
 *   - Network adapters are injected later by the WebSocket
 *     handshake handler (see `vite-plugin-automerge.ts`); they're
 *     added to `repo.networkSubsystem` per-connection.
 *
 * The first time a client requests a site's tree doc, we
 * bootstrap from SQLite — read every linked `person` /
 * `relationship` / `couple` row, write them into a fresh Automerge
 * doc, and store the doc URL in `site_automerge_docs`. On
 * subsequent connections the doc is found by URL and resumed.
 *
 * On every doc change we re-project the doc back into SQLite via
 * `projectTreeDocToSql`, so non-live consumers (GEDCOM export, the
 * server-side renderer, redaction joins) keep working without
 * caring about Automerge.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	Repo,
	isValidAutomergeUrl,
	type AutomergeUrl,
	type DocHandle
} from '@automerge/automerge-repo';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { DATA_DIR } from '$lib/server_config.js';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { getAllSitePeople, getSiteSubjectId } from '$lib/server/people.js';
import type { TreeDoc, TreeDocPerson, TreeDocCouple } from '$lib/tree_doc.js';

let repoSingleton: Repo | null = null;
const handleCache = new Map<string, DocHandle<TreeDoc>>();

export function getAutomergeRepo(): Repo {
	if (repoSingleton) return repoSingleton;
	const storageDir = join(DATA_DIR, 'automerge');
	mkdirSync(storageDir, { recursive: true });
	repoSingleton = new Repo({
		storage: new NodeFSStorageAdapter(storageDir)
	});
	return repoSingleton;
}

/** Reset the singleton — used by tests so each tmpdir gets a fresh repo. */
export function closeAutomergeRepo(): void {
	repoSingleton = null;
	handleCache.clear();
}

/**
 * Resolve (and lazily create + bootstrap) the Automerge URL for a
 * site's tree document. Caches the handle so subsequent refreshes
 * don't go through async lookup — `repo.find()` returns a
 * `Promise<DocHandle>` but our remote-function refresh path is
 * sync. The cache makes that boundary clean.
 */
export async function ensureSiteTreeDoc(siteId: string): Promise<AutomergeUrl> {
	const cached = handleCache.get(siteId);
	if (cached) return cached.url;

	const db = getPlatformDb();
	const existing = db
		.prepare(`SELECT doc_url FROM site_automerge_docs WHERE site_id = ?`)
		.get(siteId) as { doc_url: string } | undefined;

	const repo = getAutomergeRepo();

	if (existing) {
		const url = existing.doc_url;
		if (!isValidAutomergeUrl(url)) {
			throw new Error(`stored automerge url is invalid for site ${siteId}: ${url}`);
		}
		const handle = await repo.find<TreeDoc>(url);
		handleCache.set(siteId, handle);
		return url;
	}

	const handle = repo.create<TreeDoc>({
		site_id: siteId,
		subject_person_id: null,
		people: {},
		parent_edges: [],
		couples: {}
	});
	bootstrapDocFromSql(siteId, handle);
	handleCache.set(siteId, handle);

	db.prepare(
		`INSERT INTO site_automerge_docs (site_id, doc_url, created_at)
		 VALUES (?, ?, ?)`
	).run(siteId, handle.url, new Date().toISOString());

	return handle.url;
}

/**
 * Populate a freshly-created Automerge doc from the current SQLite
 * state for the site. Called once on doc creation.
 */
function bootstrapDocFromSql(siteId: string, handle: DocHandle<TreeDoc>): void {
	const tree = getAllSitePeople(siteId);
	const subjectId = getSiteSubjectId(siteId);
	handle.change((doc) => {
		doc.subject_person_id = subjectId;
		for (const p of tree.people) {
			doc.people[p.person_id] = personToDoc(p);
		}
		for (const e of tree.parent_edges) {
			doc.parent_edges.push({
				parent_id: e.parent_id,
				child_id: e.child_id,
				kind: e.kind ?? 'biological'
			});
		}
		for (const c of tree.couples) {
			doc.couples[c.couple_id] = coupleToDoc(c);
		}
	});
}

function personToDoc(p: {
	person_id: string;
	display_name: string;
	given_names: string | null;
	surname: string | null;
	sex: string | null;
	birth_date: string | null;
	birth_place: string | null;
	death_date: string | null;
	death_place: string | null;
	biography: string | null;
	is_living: 0 | 1;
}): TreeDocPerson {
	return {
		person_id: p.person_id,
		display_name: p.display_name,
		given_names: p.given_names,
		surname: p.surname,
		sex: (p.sex as TreeDocPerson['sex']) ?? null,
		birth_date: p.birth_date,
		birth_place: p.birth_place,
		death_date: p.death_date,
		death_place: p.death_place,
		biography: p.biography,
		is_living: p.is_living === 1
	};
}

function coupleToDoc(c: {
	couple_id: string;
	person_a_id: string;
	person_b_id: string;
	kind: string;
	start_date: string | null;
	end_date: string | null;
	end_reason: string | null;
}): TreeDocCouple {
	return {
		couple_id: c.couple_id,
		person_a_id: c.person_a_id,
		person_b_id: c.person_b_id,
		kind: c.kind as TreeDocCouple['kind'],
		start_date: c.start_date,
		end_date: c.end_date,
		end_reason: (c.end_reason as TreeDocCouple['end_reason']) ?? null
	};
}

/**
 * Re-project an Automerge doc into SQLite. Called after each
 * remote-function write so the doc stays in sync with SQLite (the
 * remote function is the authoritative path during this phase;
 * client-initiated writes via Automerge land in a follow-up
 * commit). Phase-3 v2 will invert: Automerge becomes authoritative,
 * SQLite is the projection.
 *
 * For now we only mirror `display_name` and the date / place
 * fields — those are the ones the existing UI can mutate. The
 * graph topology (edges + couples) only changes via dedicated
 * remote functions which already touch SQLite themselves; we
 * re-project them here too so they're observable in Automerge.
 */
export function refreshSiteTreeDoc(siteId: string): void {
	const handle = handleCache.get(siteId);
	if (!handle) return; // No active doc — no client has loaded /tree yet.
	const tree = getAllSitePeople(siteId);
	const subjectId = getSiteSubjectId(siteId);

	handle.change((doc) => {
		doc.subject_person_id = subjectId;

		// Sync person fields. Insert any new, update existing,
		// delete any in the doc that are gone from SQLite.
		const sqlIds = new Set(tree.people.map((p) => p.person_id));
		for (const docId of Object.keys(doc.people)) {
			if (!sqlIds.has(docId)) delete doc.people[docId];
		}
		for (const p of tree.people) {
			const next = personToDoc(p);
			doc.people[p.person_id] = next;
		}

		// Edges: rebuild from SQLite. The array is small and the
		// CRDT cost of full replacement is fine here — we're not
		// trying to merge concurrent edge edits yet.
		doc.parent_edges.splice(0, doc.parent_edges.length);
		for (const e of tree.parent_edges) {
			doc.parent_edges.push({
				parent_id: e.parent_id,
				child_id: e.child_id,
				kind: e.kind ?? 'biological'
			});
		}

		// Couples: same as people — keyed map.
		const sqlCoupleIds = new Set(tree.couples.map((c) => c.couple_id));
		for (const docId of Object.keys(doc.couples)) {
			if (!sqlCoupleIds.has(docId)) delete doc.couples[docId];
		}
		for (const c of tree.couples) {
			doc.couples[c.couple_id] = coupleToDoc(c);
		}
	});
}

/**
 * Refresh every Automerge doc that holds the given person — used
 * after `updatePerson` / `deletePerson` / `removeCouple` etc. where
 * the remote handler doesn't have a direct `site_id` to refresh.
 */
export function refreshTreeDocsForPerson(personId: string): void {
	const rows = getPlatformDb()
		.prepare(`SELECT site_id FROM person_memorials WHERE person_id = ?`)
		.all(personId) as { site_id: string }[];
	for (const r of rows) refreshSiteTreeDoc(r.site_id);
}

// Re-exports so callers can find the helpers without depending on
// the underlying automerge-repo package directly.
export type { TreeDoc };
export { isValidAutomergeUrl } from '@automerge/automerge-repo';
