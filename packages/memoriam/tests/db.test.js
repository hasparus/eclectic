import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let tmp_dir;

beforeEach(() => {
	tmp_dir = mkdtempSync(join(tmpdir(), 'memoriam-test-'));
	process.env.DATA_DIR = tmp_dir;
});

afterEach(async () => {
	const mod = await import('$lib/server/db.js');
	mod.close_all_dbs();
	rmSync(tmp_dir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('get_db', () => {
	it('creates a per-site DB directory and applies migrations on first open', async () => {
		const { get_db } = await import('$lib/server/db.js');
		const db = get_db('site_a');

		expect(existsSync(join(tmp_dir, 'sites', 'site_a', 'db.sqlite3'))).toBe(true);

		const row = /** @type {{ name: string } | undefined} */ (
			db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'`).get()
		);
		expect(row?.name).toBe('documents');

		const migrations = /** @type {{ count: number }} */ (
			db.prepare(`SELECT COUNT(*) AS count FROM _migrations`).get()
		);
		expect(migrations.count).toBeGreaterThan(0);
	});

	it('returns the same DatabaseSync instance on repeated calls for one site', async () => {
		const { get_db } = await import('$lib/server/db.js');
		const a = get_db('site_a');
		const b = get_db('site_a');
		expect(a).toBe(b);
	});

	it('isolates data between sites', async () => {
		const { get_db } = await import('$lib/server/db.js');
		const db_a = get_db('site_a');
		const db_b = get_db('site_b');

		db_a.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)`).run('marker', 'a');
		db_b.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)`).run('marker', 'b');

		const a_marker = /** @type {{ value: string } | undefined} */ (
			db_a.prepare(`SELECT value FROM site_settings WHERE key = 'marker'`).get()
		);
		const b_marker = /** @type {{ value: string } | undefined} */ (
			db_b.prepare(`SELECT value FROM site_settings WHERE key = 'marker'`).get()
		);

		expect(a_marker?.value).toBe('a');
		expect(b_marker?.value).toBe('b');
	});

	it('rejects invalid site ids', async () => {
		const { get_db } = await import('$lib/server/db.js');
		expect(() => get_db('')).toThrow(/Invalid site_id/);
		expect(() => get_db('../escape')).toThrow(/Invalid site_id/);
		expect(() => get_db('with/slash')).toThrow(/Invalid site_id/);
	});
});
