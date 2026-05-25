import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { DATA_DIR, site_data_dir, site_db_path, is_valid_site_id } from '$lib/server_config.js';
import migrate from '$lib/server/migrate.js';

/** Maximum number of per-site database connections kept open at once. */
const MAX_OPEN_DBS = 256;

/** @typedef {{ db: DatabaseSync, last_access_ms: number }} CachedDb */

/** @type {Map<string, CachedDb>} */
const open_dbs = new Map();

// If SEED=1, wipe the data directory before any database is opened. This
// must happen at module load (before any site DB is opened), not in init(),
// because some routes import this module eagerly.
if (process.env.SEED === '1') {
	console.log('[seed] Wiping data directory and re-seeding...');
	rmSync(DATA_DIR, { recursive: true, force: true });
}

function evict_oldest() {
	let oldest_key = null;
	let oldest_ts = Infinity;
	for (const [key, entry] of open_dbs) {
		if (entry.last_access_ms < oldest_ts) {
			oldest_ts = entry.last_access_ms;
			oldest_key = key;
		}
	}
	if (oldest_key == null) return;
	const evicted = open_dbs.get(oldest_key);
	open_dbs.delete(oldest_key);
	try {
		evicted?.db.close();
	} catch (err) {
		console.error(`Failed to close evicted db for ${oldest_key}:`, err);
	}
}

/**
 * Open (or retrieve from cache) a per-site SQLite database. Runs lazy
 * migrations on first open per site.
 *
 * @param {string} site_id
 * @returns {DatabaseSync}
 */
export function get_db(site_id) {
	if (!is_valid_site_id(site_id)) {
		throw new Error(`Invalid site_id: ${site_id}`);
	}

	const existing = open_dbs.get(site_id);
	if (existing) {
		existing.last_access_ms = Date.now();
		return existing.db;
	}

	if (open_dbs.size >= MAX_OPEN_DBS) evict_oldest();

	mkdirSync(site_data_dir(site_id), { recursive: true });
	const db = new DatabaseSync(site_db_path(site_id));
	db.exec('PRAGMA journal_mode=WAL');
	db.exec('PRAGMA busy_timeout=5000');
	migrate(db);

	open_dbs.set(site_id, { db, last_access_ms: Date.now() });
	return db;
}

/**
 * Close all open per-site database connections. Intended for graceful
 * shutdown and tests.
 */
export function close_all_dbs() {
	for (const [key, { db }] of open_dbs) {
		try {
			db.close();
		} catch (err) {
			console.error(`Failed to close db for ${key}:`, err);
		}
	}
	open_dbs.clear();
}
