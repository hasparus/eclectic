import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$lib/server_config.js';
import migratePlatform from '$lib/server/platform_migrate.js';

/**
 * The platform DB is a single SQLite database shared across the whole
 * platform — users, sites, memberships, sessions, short codes, and the
 * cross-site genealogy registry live here. Per-site content stays in
 * its own DB under data/sites/<site_id>/.
 */
const PLATFORM_DB_PATH = join(DATA_DIR, '_platform.sqlite3');

let cached: DatabaseSync | null = null;

export function getPlatformDb(): DatabaseSync {
	if (cached) return cached;

	mkdirSync(DATA_DIR, { recursive: true });
	const db = new DatabaseSync(PLATFORM_DB_PATH);
	db.exec('PRAGMA journal_mode=WAL');
	db.exec('PRAGMA busy_timeout=5000');
	db.exec('PRAGMA foreign_keys=ON');
	migratePlatform(db);

	cached = db;
	return db;
}

/** Close the cached platform DB. Tests / graceful shutdown. */
export function closePlatformDb(): void {
	if (!cached) return;
	try {
		cached.close();
	} catch (err) {
		console.error('Failed to close platform db:', err);
	}
	cached = null;
}
