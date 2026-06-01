import type { DatabaseSync } from 'node:sqlite';

interface MigrationContext {
	db: DatabaseSync;
}

type Migration = (ctx: MigrationContext) => void;

const sql = (strings: TemplateStringsArray): string => strings.join('');

// Platform-level migrations. Function names are persisted as IDs in
// the _migrations table — do not rename without a data migration.
const migrations: Migration[] = [
	function initial_platform_schema({ db }) {
		// Users: one row per human, identified by email. Display name is
		// optional; magic-link sign-in fills email and creates a user on
		// first login.
		db.exec(sql`
			CREATE TABLE users (
				user_id TEXT NOT NULL PRIMARY KEY,
				email TEXT NOT NULL UNIQUE,
				display_name TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);

		// Sites: one row per memorial. site_id is also the per-site DB
		// directory name under data/sites/<site_id>/. visibility controls
		// whether the site is reachable without authentication.
		db.exec(sql`
			CREATE TABLE sites (
				site_id TEXT NOT NULL PRIMARY KEY,
				owner_user_id TEXT NOT NULL,
				display_name TEXT,
				visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (owner_user_id) REFERENCES users(user_id)
			);
		`);

		// Memberships: which user can do what on which site. role decides
		// edit / delete / invite permissions.
		db.exec(sql`
			CREATE TABLE site_members (
				site_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
				created_at TEXT NOT NULL,
				PRIMARY KEY (site_id, user_id),
				FOREIGN KEY (site_id) REFERENCES sites(site_id),
				FOREIGN KEY (user_id) REFERENCES users(user_id)
			);
		`);

		// Custom domains: host header → site_id. Hostname is the primary
		// key so it's globally unique across the platform.
		db.exec(sql`
			CREATE TABLE domains (
				domain TEXT NOT NULL PRIMARY KEY,
				site_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);

		// Invites: outstanding invitations to join a site. accepted_at is
		// set when the invitee accepts.
		db.exec(sql`
			CREATE TABLE invites (
				invite_token TEXT NOT NULL PRIMARY KEY,
				site_id TEXT NOT NULL,
				email TEXT NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
				created_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				accepted_at TEXT,
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);

		// Platform sessions: opaque session cookie → user_id. Replaces
		// the per-site sessions table that lived in each site's DB.
		db.exec(sql`
			CREATE TABLE platform_sessions (
				session_id TEXT NOT NULL PRIMARY KEY,
				user_id TEXT NOT NULL,
				expires INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(user_id)
			);
		`);

		// Magic-link tokens: short-lived bearer tokens emailed to a user.
		// Consumed once, then either grants a session (if user exists) or
		// creates one (if first sign-in).
		db.exec(sql`
			CREATE TABLE magic_link_tokens (
				token TEXT NOT NULL PRIMARY KEY,
				email TEXT NOT NULL,
				expires INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				consumed_at TEXT
			);
		`);

		// Short codes: permanent redirects. Used for QR codes engraved on
		// physical objects — once issued, a code must resolve forever (see
		// PLAN.md). target_path defaults to '/' if not set.
		db.exec(sql`
			CREATE TABLE short_codes (
				code TEXT NOT NULL PRIMARY KEY,
				site_id TEXT NOT NULL,
				target_path TEXT NOT NULL DEFAULT '/',
				created_at TEXT NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);

		// Useful indexes for lookups in the hot path.
		db.exec(sql`CREATE INDEX site_members_user_id_idx ON site_members (user_id);`);
		db.exec(sql`CREATE INDEX platform_sessions_user_id_idx ON platform_sessions (user_id);`);
		db.exec(sql`CREATE INDEX invites_email_idx ON invites (email);`);
		db.exec(sql`CREATE INDEX short_codes_site_id_idx ON short_codes (site_id);`);
	},

	function add_genealogy_registry({ db }) {
		// Cross-site person registry. A "person" is a node in the family
		// tree, distinct from a "memorial" (which is a per-site editable
		// page). One person can be linked from many memorials.
		db.exec(sql`
			CREATE TABLE people (
				person_id TEXT NOT NULL PRIMARY KEY,
				display_name TEXT NOT NULL,
				given_names TEXT,
				surname TEXT,
				birth_year INTEGER,
				death_year INTEGER,
				is_living INTEGER NOT NULL DEFAULT 0 CHECK (is_living IN (0,1)),
				privacy_level TEXT NOT NULL DEFAULT 'public' CHECK (privacy_level IN ('public','members','private')),
				owner_user_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (owner_user_id) REFERENCES users(user_id)
			);
		`);

		// Aliases: maiden names, alternate spellings, nicknames.
		db.exec(sql`
			CREATE TABLE person_aliases (
				person_id TEXT NOT NULL,
				alias TEXT NOT NULL,
				source TEXT,
				PRIMARY KEY (person_id, alias),
				FOREIGN KEY (person_id) REFERENCES people(person_id)
			);
		`);

		// Relationships: directed parent → child edges. Spouses stored as
		// relation_type='spouse' (the edge is undirected semantically but
		// we keep a row ordering for deterministic queries).
		db.exec(sql`
			CREATE TABLE relationships (
				from_person_id TEXT NOT NULL,
				to_person_id TEXT NOT NULL,
				relation_type TEXT NOT NULL CHECK (relation_type IN ('parent_of','spouse_of','sibling_of')),
				certainty TEXT NOT NULL DEFAULT 'certain' CHECK (certainty IN ('certain','probable','unverified')),
				source_note TEXT,
				created_at TEXT NOT NULL,
				PRIMARY KEY (from_person_id, to_person_id, relation_type),
				FOREIGN KEY (from_person_id) REFERENCES people(person_id),
				FOREIGN KEY (to_person_id) REFERENCES people(person_id)
			);
		`);

		// Person ↔ memorial link. Each row says "this person has a memorial
		// page on this site." Composite primary key prevents duplicates.
		db.exec(sql`
			CREATE TABLE person_memorials (
				person_id TEXT NOT NULL,
				site_id TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (person_id, site_id),
				FOREIGN KEY (person_id) REFERENCES people(person_id),
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);

		// Per-person ACL: who can edit / see a person record.
		db.exec(sql`
			CREATE TABLE person_access (
				person_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
				created_at TEXT NOT NULL,
				PRIMARY KEY (person_id, user_id),
				FOREIGN KEY (person_id) REFERENCES people(person_id),
				FOREIGN KEY (user_id) REFERENCES users(user_id)
			);
		`);

		db.exec(sql`CREATE INDEX relationships_to_idx ON relationships (to_person_id);`);
		db.exec(sql`CREATE INDEX person_memorials_site_id_idx ON person_memorials (site_id);`);
		db.exec(sql`CREATE INDEX person_access_user_id_idx ON person_access (user_id);`);
	},

	function extend_genealogy_for_tree_v1({ db }) {
		// The initial registry stored only birth/death YEAR and lacked a
		// few fields the tree UI needs. Add them all as nullable columns
		// — the existing rows (none in any live deployment yet) stay
		// valid; new rows will populate them.
		db.exec(sql`ALTER TABLE people ADD COLUMN sex TEXT CHECK (sex IN ('M','F','X','U') OR sex IS NULL);`);
		db.exec(sql`ALTER TABLE people ADD COLUMN birth_date TEXT;`);
		db.exec(sql`ALTER TABLE people ADD COLUMN birth_place TEXT;`);
		db.exec(sql`ALTER TABLE people ADD COLUMN death_date TEXT;`);
		db.exec(sql`ALTER TABLE people ADD COLUMN death_place TEXT;`);
		db.exec(sql`ALTER TABLE people ADD COLUMN biography TEXT;`);

		// Per-edge nature for parent_of edges. Sibling_of edges leave it
		// NULL. Default 'biological' is set in the insert path, not in
		// the column default, so existing rows stay unannotated.
		db.exec(sql`ALTER TABLE relationships ADD COLUMN kind TEXT CHECK (kind IN ('biological','adoptive','foster','step','unknown') OR kind IS NULL);`);

		// Marriages / partnerships. Modelled as their own table rather
		// than `relationships.spouse_of` rows — they need start/end
		// dates and an end_reason that don't fit the edge schema, and
		// a single person can be in many couples sequentially.
		//
		// We normalise so person_a_id < person_b_id; that gives a
		// deterministic unique key and lets us dedup without ordering
		// the inputs in every caller.
		db.exec(sql`
			CREATE TABLE couples (
				couple_id TEXT NOT NULL PRIMARY KEY,
				person_a_id TEXT NOT NULL,
				person_b_id TEXT NOT NULL,
				kind TEXT NOT NULL DEFAULT 'marriage' CHECK (kind IN ('marriage','partnership','engagement','other')),
				start_date TEXT,
				end_date TEXT,
				end_reason TEXT CHECK (end_reason IN ('divorce','death','annulment','separation') OR end_reason IS NULL),
				certainty TEXT NOT NULL DEFAULT 'certain' CHECK (certainty IN ('certain','probable','unverified')),
				source_note TEXT,
				created_at TEXT NOT NULL,
				CHECK (person_a_id < person_b_id),
				FOREIGN KEY (person_a_id) REFERENCES people(person_id),
				FOREIGN KEY (person_b_id) REFERENCES people(person_id)
			);
		`);
		db.exec(sql`CREATE INDEX couples_person_a_idx ON couples (person_a_id);`);
		db.exec(sql`CREATE INDEX couples_person_b_idx ON couples (person_b_id);`);
		db.exec(sql`CREATE UNIQUE INDEX couples_pair_idx ON couples (person_a_id, person_b_id);`);

		// A memorial site is "about" one focal person. The /tree page
		// renders the tree rooted on this id. Nullable until the
		// owner sets it (or accepts the auto-suggestion built from
		// site.display_name).
		db.exec(sql`ALTER TABLE sites ADD COLUMN subject_person_id TEXT REFERENCES people(person_id);`);
	},

	function add_automerge_doc_index({ db }) {
		// Per-site Automerge document used for real-time
		// multiplayer editing of the tree. The actual doc binary
		// lives on disk (handled by automerge-repo's nodefs
		// storage adapter at `data/automerge/`); this row only
		// maps the site to its Automerge document URL so the
		// server can find / lazily-create the doc when a client
		// connects.
		//
		// Stored at the platform level rather than per-site so a
		// future migration to a different storage layout doesn't
		// have to touch every per-site DB.
		db.exec(sql`
			CREATE TABLE site_automerge_docs (
				site_id TEXT NOT NULL PRIMARY KEY,
				doc_url TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);
	},

	function add_page_broadcast_doc_index({ db }) {
		// Per-site Automerge document for the page-edit broadcast
		// channel. Separate from `site_automerge_docs` (tree) so
		// the two streams don't tangle — the only shared field is
		// `updated_at` and the only consumer is the page route's
		// `invalidateAll()` trigger.
		//
		// One doc per site (not per document) — every page save
		// bumps the same doc and every reader of any page on the
		// site listens to it. That keeps the wiring trivial and
		// matches the current single-tenant-per-site UX where a
		// user typically has one editor open at a time.
		db.exec(sql`
			CREATE TABLE site_page_automerge_docs (
				site_id TEXT NOT NULL PRIMARY KEY,
				doc_url TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL,
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);
	},

	function add_document_automerge_doc_index({ db }) {
		// Per-document Automerge doc — one per `documents` row.
		// Holds the live editing state as `{ document_id, nodes }`.
		// svedit's Session binds to this handle: local ops mirror
		// into the doc, remote changes flow back into the rendered
		// state. The broadcast layer above stays for nav/footer +
		// page-list invalidations; this one carries the real
		// content-level CRDT.
		db.exec(sql`
			CREATE TABLE document_automerge_docs (
				site_id TEXT NOT NULL,
				document_id TEXT NOT NULL,
				doc_url TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL,
				PRIMARY KEY (site_id, document_id),
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);
	},

	function consolidate_automerge_doc_tables({ db }) {
		// Roll the three per-kind tables — `site_automerge_docs`
		// (tree), `site_page_automerge_docs` (broadcast),
		// `document_automerge_docs` (per-document) — into a single
		// `automerge_docs(site_id, kind, target_id, doc_url)` table.
		// `target_id` is empty for site-wide kinds (`tree`,
		// `page_broadcast`) and carries the document id for the
		// `document` kind.
		db.exec(sql`
			CREATE TABLE automerge_docs (
				site_id TEXT NOT NULL,
				kind TEXT NOT NULL CHECK (kind IN ('tree', 'page_broadcast', 'document')),
				target_id TEXT NOT NULL DEFAULT '',
				doc_url TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL,
				PRIMARY KEY (site_id, kind, target_id),
				FOREIGN KEY (site_id) REFERENCES sites(site_id)
			);
		`);
		db.exec(sql`
			INSERT INTO automerge_docs (site_id, kind, target_id, doc_url, created_at)
			SELECT site_id, 'tree', '', doc_url, created_at FROM site_automerge_docs;
		`);
		db.exec(sql`
			INSERT INTO automerge_docs (site_id, kind, target_id, doc_url, created_at)
			SELECT site_id, 'page_broadcast', '', doc_url, created_at FROM site_page_automerge_docs;
		`);
		db.exec(sql`
			INSERT INTO automerge_docs (site_id, kind, target_id, doc_url, created_at)
			SELECT site_id, 'document', document_id, doc_url, created_at FROM document_automerge_docs;
		`);
		db.exec(sql`DROP TABLE site_automerge_docs;`);
		db.exec(sql`DROP TABLE site_page_automerge_docs;`);
		db.exec(sql`DROP TABLE document_automerge_docs;`);
	}
];

export default migrations;
