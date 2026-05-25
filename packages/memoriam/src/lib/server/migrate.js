import migrations from './migrations.js';

/**
 * Pad the ISO timestamp with a monotonic index so ORDER BY timestamp
 * preserves migration order even when migrations apply within the same
 * millisecond.
 *
 * @param {string} base_iso
 * @param {number} index
 * @returns {string}
 */
function timestamp_with_index(base_iso, index) {
	return `${base_iso}.${String(index).padStart(4, '0')}`;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export default function migrate(db) {
	// Invariants
	const migration_names = migrations.map((migration) => migration.name);
	if (new Set(migration_names).size !== migration_names.length) {
		throw new Error('Duplicate migration names. Check migrations.js for unique function names.');
	}

	// Add _migrations tracker table if it doesn't exist yet.
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			id TEXT PRIMARY KEY NOT NULL,
			timestamp TEXT NOT NULL
		)
	`);

	// Fetch latest migration that has already been applied
	const latest = db
		.prepare(
			`
		SELECT id, timestamp FROM _migrations
		ORDER BY timestamp DESC
		LIMIT 1
		`
		)
		.get();

	let remaining_migrations;
	if (latest) {
		console.log(`Latest migration: ${latest.id} at ${latest.timestamp}`);
		const latest_index = migrations.findIndex((migration) => migration.name === latest.id);

		if (latest_index >= 0) {
			remaining_migrations = migrations.slice(latest_index + 1);
		} else {
			console.log(
				`Migration ${latest.id} is not found in migrations.js. Make sure to keep all migrations in sync between your local and production environment.`
			);
			remaining_migrations = []; // we just skip migrations
		}
	} else {
		console.log(`No previous migrations found.`);
		remaining_migrations = migrations;
	}

	console.log(`${remaining_migrations.length} migrations to be applied...`);

	// The whole migration operation is wrapped in a transaction, so if something fails, everything is
	// rolled back. When migrations are done as part of the deploy process this means the deploy failed.
	// You likely have a bug in the migration code, which needs to be fixed before you can make a
	// successful deploy.
	db.exec('BEGIN TRANSACTION');

	try {
		const run_at_iso = new Date().toISOString();
		for (const [index, migration] of remaining_migrations.entries()) {
			const migration_name = migration.name;
			if (!migration_name) throw new Error('Migration name (e.g. add_name_to_user) is required.');

			console.log('Running migration... ', migration_name);
			// Run the migration and provide db as context
			migration({ db });
			// Save migration to _migrations table
			db.prepare(
				`
				INSERT INTO _migrations (id, timestamp)
				VALUES (?, ?)
			`
			).run(migration_name, timestamp_with_index(run_at_iso, index));
		}
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}