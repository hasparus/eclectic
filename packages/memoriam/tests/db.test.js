import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let tmpDir;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'memoriam-test-'));
	process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
	const mod = await import('$lib/server/db.js');
	mod.closeAllDbs();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('getDb', () => {
	it('creates a per-site DB directory and applies migrations on first open', async () => {
		const { getDb } = await import('$lib/server/db.js');
		const db = getDb('site_a');

		expect(existsSync(join(tmpDir, 'sites', 'site_a', 'db.sqlite3'))).toBe(true);

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
		const { getDb } = await import('$lib/server/db.js');
		const a = getDb('site_a');
		const b = getDb('site_a');
		expect(a).toBe(b);
	});

	it('isolates data between sites', async () => {
		const { getDb } = await import('$lib/server/db.js');
		const dbA = getDb('site_a');
		const dbB = getDb('site_b');

		dbA.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)`).run('marker', 'a');
		dbB.prepare(`INSERT INTO site_settings (key, value) VALUES (?, ?)`).run('marker', 'b');

		const aMarker = /** @type {{ value: string } | undefined} */ (
			dbA.prepare(`SELECT value FROM site_settings WHERE key = 'marker'`).get()
		);
		const bMarker = /** @type {{ value: string } | undefined} */ (
			dbB.prepare(`SELECT value FROM site_settings WHERE key = 'marker'`).get()
		);

		expect(aMarker?.value).toBe('a');
		expect(bMarker?.value).toBe('b');
	});

	it('rejects invalid site ids', async () => {
		const { getDb } = await import('$lib/server/db.js');
		expect(() => getDb('')).toThrow(/Invalid siteId/);
		expect(() => getDb('../escape')).toThrow(/Invalid siteId/);
		expect(() => getDb('with/slash')).toThrow(/Invalid siteId/);
	});
});
