import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @type {string} */
let tmpDir;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'memoriam-platform-'));
	process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
	const platform = await import('$lib/server/platform_db.js');
	platform.closePlatformDb();
	const sites = await import('$lib/server/db.js');
	sites.closeAllDbs();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('platform DB', () => {
	it('creates _platform.sqlite3 and applies migrations on first open', async () => {
		const { getPlatformDb } = await import('$lib/server/platform_db.js');
		const db = getPlatformDb();

		expect(existsSync(join(tmpDir, '_platform.sqlite3'))).toBe(true);

		// Spot-check a few key tables.
		for (const table of ['users', 'sites', 'site_members', 'platform_sessions', 'magic_link_tokens', 'short_codes', 'people']) {
			const row = /** @type {{ name: string } | undefined} */ (
				db
					.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
					.get(table)
			);
			expect(row?.name).toBe(table);
		}
	});

	it('returns the same DatabaseSync instance on repeated calls', async () => {
		const { getPlatformDb } = await import('$lib/server/platform_db.js');
		const a = getPlatformDb();
		const b = getPlatformDb();
		expect(a).toBe(b);
	});
});

describe('user upsert', () => {
	it('creates a user on first call, returns existing on second', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const u1 = upsertUserByEmail('alice@example.com');
		const u2 = upsertUserByEmail('  Alice@Example.com  '); // trimmed + lowercased
		expect(u1.user_id).toBe(u2.user_id);
		expect(u1.email).toBe('alice@example.com');
	});
});

describe('magic link', () => {
	it('issues and consumes a token exactly once', async () => {
		const { issueMagicLink, consumeMagicLink } = await import('$lib/server/magic_link.js');
		const issued = issueMagicLink('bob@example.com');
		expect(issued.token).toBeTruthy();
		expect(issued.email).toBe('bob@example.com');

		const first = consumeMagicLink(issued.token);
		expect(first.ok).toBe(true);
		expect(first.email).toBe('bob@example.com');

		const second = consumeMagicLink(issued.token);
		expect(second.ok).toBe(false);
		expect(second.reason).toBe('already_consumed');
	});

	it('rejects unknown tokens', async () => {
		const { consumeMagicLink } = await import('$lib/server/magic_link.js');
		const result = consumeMagicLink('not-a-real-token');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('unknown');
	});
});

describe('sessions', () => {
	it('round-trips a session', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createPlatformSession, getPlatformSession, deletePlatformSession } = await import(
			'$lib/server/sessions.js'
		);

		const user = upsertUserByEmail('carol@example.com');
		const session = createPlatformSession(user.user_id);
		expect(session.user_id).toBe(user.user_id);

		const fetched = getPlatformSession(session.session_id);
		expect(fetched?.user_id).toBe(user.user_id);

		deletePlatformSession(session.session_id);
		expect(getPlatformSession(session.session_id)).toBeNull();
	});
});

describe('sites', () => {
	it('creates a site, sets owner membership, opens per-site DB', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite, getSite, getSiteMember, userCanEditSite } = await import(
			'$lib/server/sites.js'
		);
		const { siteDbPath } = await import('$lib/server_config.js');

		const user = upsertUserByEmail('dan@example.com');
		const site = createSite({ ownerUserId: user.user_id, displayName: 'Dan family memorial' });

		const fetched = getSite(site.site_id);
		expect(fetched?.display_name).toBe('Dan family memorial');
		expect(fetched?.owner_user_id).toBe(user.user_id);

		const member = getSiteMember(site.site_id, user.user_id);
		expect(member?.role).toBe('owner');

		expect(userCanEditSite(site.site_id, user.user_id)).toBe(true);
		expect(userCanEditSite(site.site_id, null)).toBe(false);

		// Per-site DB file was created (uses module-cached DATA_DIR, may differ
		// from the fresh tmpDir if this test isn't the first to import).
		expect(existsSync(siteDbPath(site.site_id))).toBe(true);
	});

	it('refuses a duplicate preferred site_id', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');

		const user = upsertUserByEmail('eve@example.com');
		createSite({ ownerUserId: user.user_id, preferredSiteId: 'fixedname' });
		expect(() => createSite({ ownerUserId: user.user_id, preferredSiteId: 'fixedname' })).toThrow(
			/already taken/
		);
	});
});

describe('site resolution', () => {
	it('resolves a custom domain', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { getPlatformDb } = await import('$lib/server/platform_db.js');
		const { resolveSiteIdFromUrl } = await import('$lib/server/site_resolution.js');

		const user = upsertUserByEmail('frank@example.com');
		const site = createSite({ ownerUserId: user.user_id, preferredSiteId: 'franks' });

		getPlatformDb()
			.prepare('INSERT INTO domains (domain, site_id, created_at) VALUES (?, ?, ?)')
			.run('memorial.franks.com', site.site_id, new Date().toISOString());

		expect(resolveSiteIdFromUrl(new URL('https://memorial.franks.com/'))).toBe('franks');
	});

	it('resolves a subdomain on the platform host', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { resolveSiteIdFromUrl } = await import('$lib/server/site_resolution.js');

		const user = upsertUserByEmail('gina@example.com');
		createSite({ ownerUserId: user.user_id, preferredSiteId: 'ginas' });

		expect(resolveSiteIdFromUrl(new URL('https://ginas.memoriam.app/'))).toBe('ginas');
	});

	it('returns null when nothing matches', async () => {
		const { resolveSiteIdFromUrl } = await import('$lib/server/site_resolution.js');
		expect(resolveSiteIdFromUrl(new URL('https://random.example.com/'))).toBeNull();
	});
});
