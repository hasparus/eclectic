import { NAV_1, FOOTER_1, PAGE_1 } from '$lib/demo_doc.js';
import { MEDIA_DEFAULTS } from '$lib/config.js';
import type { DatabaseSync } from 'node:sqlite';

interface MigrationContext {
	db: DatabaseSync;
}

type Migration = (ctx: MigrationContext) => void;

// No-op tag for SQL syntax highlighting with the SQL Tagged Template
// Literals VSCode extension.
const sql = (strings: TemplateStringsArray): string => strings.join('');

function createEmptyAnnotatedText() {
	return {
		text: '',
		annotations: []
	};
}

function createEmptyImageNode(id: string) {
	return {
		id,
		type: 'image',
		...MEDIA_DEFAULTS
	};
}

/**
 * Deep clone a document and reset image/video nodes to MEDIA_DEFAULTS —
 * a fresh database has no uploaded assets yet.
 */
function resetMediaNodes(doc: unknown) {
	const cloned = JSON.parse(JSON.stringify(doc));
	for (const node of Object.values(cloned.nodes) as Record<string, unknown>[]) {
		if ('src' in node) {
			Object.assign(node, MEDIA_DEFAULTS);
		}
	}
	return cloned;
}

const nav1 = resetMediaNodes(NAV_1);
const footer1 = resetMediaNodes(FOOTER_1);
const page1 = resetMediaNodes(PAGE_1);

// Migration function names are persisted to the `_migrations` table as
// IDs. Renaming them would orphan applied migrations on existing
// databases. Keep them snake_case for stability across deployments.
const migrations: Migration[] = [
	function initial_schema({ db }) {
		db.exec(sql`
			CREATE TABLE documents (
				document_id TEXT NOT NULL PRIMARY KEY,
				type TEXT NOT NULL,
				data TEXT
			);
		`);

		db.exec(sql`
			CREATE TABLE site_settings (
				key TEXT NOT NULL PRIMARY KEY,
				value TEXT
			);
		`);

		db.exec(sql`
			CREATE TABLE document_refs (
				target_document_id TEXT NOT NULL,
				source_document_id TEXT NOT NULL,
				ref_order INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (target_document_id, source_document_id)
			);
		`);

		db.exec(sql`
			CREATE TABLE asset_refs (
				asset_id TEXT NOT NULL,
				document_id TEXT NOT NULL,
				PRIMARY KEY (asset_id, document_id)
			);
		`);

		db.exec(sql`
			CREATE TABLE document_slugs (
				slug TEXT NOT NULL PRIMARY KEY,
				document_id TEXT NOT NULL,
				is_active INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL
			);
		`);

		// Phase 1 created sessions per-site. Phase 2 moved sessions to the
		// platform DB and the table is dropped by `drop_per_site_sessions`
		// below. The create+drop dance stays so already-applied initial
		// migrations match this file's checksum.
		db.exec(sql`
			CREATE TABLE sessions (
				session_id TEXT NOT NULL PRIMARY KEY,
				expires INTEGER NOT NULL
			);
		`);

		db.exec(sql`
			CREATE UNIQUE INDEX document_slugs_active_document_id_idx
			ON document_slugs (document_id)
			WHERE is_active = 1
		`);

		const insertDoc = db.prepare(
			'INSERT INTO documents (document_id, type, data) VALUES(?, ?, ?)'
		);
		insertDoc.run('nav_1', 'nav', JSON.stringify(nav1));
		insertDoc.run('footer_1', 'footer', JSON.stringify(footer1));
		insertDoc.run('page_1', 'page', JSON.stringify(page1));

		db.prepare('INSERT INTO site_settings (key, value) VALUES(?, ?)').run(
			'home_page_id',
			'page_1'
		);
	},
	function add_page_metadata_fields({ db }) {
		const pageRows = db
			.prepare('SELECT document_id, data FROM documents WHERE type = ?')
			.all('page') as Array<{ document_id: string; data: string }>;
		const updateDoc = db.prepare('UPDATE documents SET data = ? WHERE document_id = ?');

		for (const row of pageRows) {
			const doc = JSON.parse(row.data);
			const pageNode = doc?.nodes?.[doc.document_id];

			if (!pageNode || pageNode.type !== 'page') continue;

			let didChange = false;

			if (!pageNode.title) {
				pageNode.title = createEmptyAnnotatedText();
				didChange = true;
			}

			if (!pageNode.description) {
				pageNode.description = createEmptyAnnotatedText();
				didChange = true;
			}

			if (didChange) {
				updateDoc.run(JSON.stringify(doc), row.document_id);
			}
		}
	},
	function add_page_image_nodes({ db }) {
		const pageRows = db
			.prepare('SELECT document_id, data FROM documents WHERE type = ?')
			.all('page') as Array<{ document_id: string; data: string }>;
		const updateDoc = db.prepare('UPDATE documents SET data = ? WHERE document_id = ?');

		for (const row of pageRows) {
			const doc = JSON.parse(row.data);
			const pageNode = doc?.nodes?.[doc.document_id];

			if (!pageNode || pageNode.type !== 'page') continue;

			let didChange = false;
			const pageImageId =
				typeof pageNode.image === 'string' ? pageNode.image : `${doc.document_id}_image`;

			if (typeof pageNode.image !== 'string') {
				pageNode.image = pageImageId;
				didChange = true;
			}

			const pageImageNode = doc.nodes?.[pageImageId];
			if (!pageImageNode || pageImageNode.type !== 'image') {
				doc.nodes[pageImageId] = createEmptyImageNode(pageImageId);
				didChange = true;
			}

			if (didChange) {
				updateDoc.run(JSON.stringify(doc), row.document_id);
			}
		}
	},
	function add_document_timestamps({ db }) {
		const now = new Date().toISOString();

		db.exec(sql`
			ALTER TABLE documents ADD COLUMN created_at TEXT
		`);
		db.exec(sql`
			ALTER TABLE documents ADD COLUMN updated_at TEXT
		`);

		db.prepare(
			`
				UPDATE documents
				SET created_at = COALESCE(created_at, ?),
					updated_at = COALESCE(updated_at, ?)
			`
		).run(now, now);
	},
	function drop_per_site_sessions({ db }) {
		// Sessions are now platform-level (Phase 2). The per-site
		// `sessions` table is no longer read or written; drop it.
		db.exec(sql`DROP TABLE IF EXISTS sessions`);
	}
];

export default migrations;
