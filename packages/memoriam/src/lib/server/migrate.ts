import migrations from './migrations.js';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Pad the ISO timestamp with a monotonic index so ORDER BY timestamp
 * preserves migration order even when migrations apply within the same
 * millisecond.
 */
function timestampWithIndex(baseIso: string, index: number): string {
	return `${baseIso}.${String(index).padStart(4, '0')}`;
}

export default function migrate(db: DatabaseSync): void {
	const migrationNames = migrations.map((migration) => migration.name);
	if (new Set(migrationNames).size !== migrationNames.length) {
		throw new Error('Duplicate migration names. Check migrations.ts for unique function names.');
	}

	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			id TEXT PRIMARY KEY NOT NULL,
			timestamp TEXT NOT NULL
		)
	`);

	const latest = db
		.prepare(
			`
		SELECT id, timestamp FROM _migrations
		ORDER BY timestamp DESC
		LIMIT 1
		`
		)
		.get() as { id: string; timestamp: string } | undefined;

	let remainingMigrations: typeof migrations;
	if (latest) {
		console.log(`Latest migration: ${latest.id} at ${latest.timestamp}`);
		const latestIndex = migrations.findIndex((migration) => migration.name === latest.id);

		if (latestIndex >= 0) {
			remainingMigrations = migrations.slice(latestIndex + 1);
		} else {
			console.log(
				`Migration ${latest.id} is not found in migrations.ts. Keep migrations in sync between local and production.`
			);
			remainingMigrations = [];
		}
	} else {
		console.log(`No previous migrations found.`);
		remainingMigrations = migrations;
	}

	console.log(`${remainingMigrations.length} migrations to be applied...`);

	// Whole migration is one transaction — failure rolls everything back.
	db.exec('BEGIN TRANSACTION');

	try {
		const runAtIso = new Date().toISOString();
		for (const [index, migration] of remainingMigrations.entries()) {
			const migrationName = migration.name;
			if (!migrationName) throw new Error('Migration name (e.g. add_name_to_user) is required.');

			console.log('Running migration... ', migrationName);
			migration({ db });
			db.prepare(
				`
				INSERT INTO _migrations (id, timestamp)
				VALUES (?, ?)
			`
			).run(migrationName, timestampWithIndex(runAtIso, index));
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}
