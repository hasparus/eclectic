import migrations from './platform_migrations.js';
import type { DatabaseSync } from 'node:sqlite';

function timestampWithIndex(baseIso: string, index: number): string {
	return `${baseIso}.${String(index).padStart(4, '0')}`;
}

/**
 * Apply pending platform-DB migrations. The platform DB holds users,
 * sites, memberships, sessions, short codes, and (when added) the
 * cross-site genealogy registry.
 */
export default function migratePlatform(db: DatabaseSync): void {
	const migrationNames = migrations.map((m) => m.name);
	if (new Set(migrationNames).size !== migrationNames.length) {
		throw new Error(
			'Duplicate platform migration names. Check platform_migrations.ts for unique function names.'
		);
	}

	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			id TEXT PRIMARY KEY NOT NULL,
			timestamp TEXT NOT NULL
		)
	`);

	const latest = db
		.prepare(`SELECT id, timestamp FROM _migrations ORDER BY timestamp DESC LIMIT 1`)
		.get() as { id: string; timestamp: string } | undefined;

	let remainingMigrations: typeof migrations;
	if (latest) {
		console.log(`[platform] Latest migration: ${latest.id} at ${latest.timestamp}`);
		const latestIndex = migrations.findIndex((m) => m.name === latest.id);
		if (latestIndex >= 0) {
			remainingMigrations = migrations.slice(latestIndex + 1);
		} else {
			console.log(
				`[platform] Migration ${latest.id} is not found in platform_migrations.ts; skipping.`
			);
			remainingMigrations = [];
		}
	} else {
		console.log(`[platform] No previous migrations found.`);
		remainingMigrations = migrations;
	}

	console.log(`[platform] ${remainingMigrations.length} migrations to be applied...`);

	db.exec('BEGIN TRANSACTION');
	try {
		const runAtIso = new Date().toISOString();
		for (const [index, migration] of remainingMigrations.entries()) {
			const migrationName = migration.name;
			if (!migrationName) throw new Error('Migration name is required.');

			console.log('[platform] Running migration...', migrationName);
			migration({ db });
			db.prepare(`INSERT INTO _migrations (id, timestamp) VALUES (?, ?)`).run(
				migrationName,
				timestampWithIndex(runAtIso, index)
			);
		}
		db.exec('COMMIT');
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}
