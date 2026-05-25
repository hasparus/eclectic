import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { DATA_DIR, siteDataDir, siteDbPath, isValidSiteId } from '$lib/server_config.js';
import migrate from '$lib/server/migrate.js';

/** Maximum number of per-site database connections kept open at once. */
const MAX_OPEN_DBS = 256;

interface CachedDb {
	db: DatabaseSync;
	lastAccessMs: number;
}

const openDbs = new Map<string, CachedDb>();

// SEED=1 wipes the data directory before any database is opened. Must
// happen at module load (before any site DB is opened), not in init(),
// because some routes import this module eagerly.
if (process.env.SEED === '1') {
	console.log('[seed] Wiping data directory and re-seeding...');
	rmSync(DATA_DIR, { recursive: true, force: true });
}

function evictOldest(): void {
	let oldestKey: string | null = null;
	let oldestTs = Infinity;
	for (const [key, entry] of openDbs) {
		if (entry.lastAccessMs < oldestTs) {
			oldestTs = entry.lastAccessMs;
			oldestKey = key;
		}
	}
	if (oldestKey == null) return;
	const evicted = openDbs.get(oldestKey);
	openDbs.delete(oldestKey);
	try {
		evicted?.db.close();
	} catch (err) {
		console.error(`Failed to close evicted db for ${oldestKey}:`, err);
	}
}

/**
 * Open (or retrieve from cache) a per-site SQLite database. Runs lazy
 * migrations on first open per site.
 */
export function getDb(siteId: string): DatabaseSync {
	if (!isValidSiteId(siteId)) {
		throw new Error(`Invalid siteId: ${siteId}`);
	}

	const existing = openDbs.get(siteId);
	if (existing) {
		existing.lastAccessMs = Date.now();
		return existing.db;
	}

	if (openDbs.size >= MAX_OPEN_DBS) evictOldest();

	mkdirSync(siteDataDir(siteId), { recursive: true });
	const db = new DatabaseSync(siteDbPath(siteId));
	db.exec('PRAGMA journal_mode=WAL');
	db.exec('PRAGMA busy_timeout=5000');
	migrate(db);

	openDbs.set(siteId, { db, lastAccessMs: Date.now() });
	return db;
}

/**
 * Close all open per-site database connections. Intended for graceful
 * shutdown and tests.
 */
export function closeAllDbs(): void {
	for (const [key, { db }] of openDbs) {
		try {
			db.close();
		} catch (err) {
			console.error(`Failed to close db for ${key}:`, err);
		}
	}
	openDbs.clear();
}
