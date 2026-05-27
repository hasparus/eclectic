import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'memoriam-phase2-tail-'));
	process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
	const platform = await import('$lib/server/platform_db.js');
	platform.closePlatformDb();
	const sites = await import('$lib/server/db.js');
	sites.closeAllDbs();
	const rate = await import('$lib/server/rate_limit.js');
	rate.clearRateLimits();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('short codes', () => {
	it('issues and resolves a short code', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { issueShortCode, resolveShortCode } = await import(
			'$lib/server/short_codes.js'
		);

		const user = upsertUserByEmail('a@example.com');
		const site = createSite({ ownerUserId: user.user_id });
		const code = issueShortCode(site.site_id, '/grandma');
		expect(code.code).toMatch(/^[A-Za-z0-9]{11}$/);

		const resolved = resolveShortCode(code.code);
		expect(resolved?.site_id).toBe(site.site_id);
		expect(resolved?.target_path).toBe('/grandma');
	});

	it('returns null for unknown codes', async () => {
		const { resolveShortCode } = await import('$lib/server/short_codes.js');
		expect(resolveShortCode('not-a-real-code')).toBeNull();
	});
});

describe('rate limit', () => {
	it('rejects after the bucket fills, allows again after the window', async () => {
		const { checkRateLimit, clearRateLimits } = await import(
			'$lib/server/rate_limit.js'
		);
		clearRateLimits();

		const config = { max: 3, windowMs: 50 };
		expect(checkRateLimit('k', config).ok).toBe(true);
		expect(checkRateLimit('k', config).ok).toBe(true);
		expect(checkRateLimit('k', config).ok).toBe(true);
		expect(checkRateLimit('k', config).ok).toBe(false);

		await new Promise((r) => setTimeout(r, 80));
		expect(checkRateLimit('k', config).ok).toBe(true);
	});

	it('tracks keys independently', async () => {
		const { checkRateLimit } = await import('$lib/server/rate_limit.js');
		const config = { max: 1, windowMs: 1000 };
		expect(checkRateLimit('a', config).ok).toBe(true);
		expect(checkRateLimit('b', config).ok).toBe(true);
		expect(checkRateLimit('a', config).ok).toBe(false);
		expect(checkRateLimit('b', config).ok).toBe(false);
	});
});

describe('storage quota', () => {
	it('reports 0 usage for a site with no assets', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { getSiteStorageStatus } = await import('$lib/server/storage_quota.js');

		const user = upsertUserByEmail('q@example.com');
		const site = createSite({ ownerUserId: user.user_id });

		const status = await getSiteStorageStatus(site.site_id);
		expect(status.usedBytes).toBe(0);
		expect(status.over).toBe(false);
		expect(status.availableBytes).toBeGreaterThan(0);
	});

	it('sums file sizes recursively under the assets dir', async () => {
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { getSiteStorageStatus } = await import('$lib/server/storage_quota.js');
		const { siteAssetPath } = await import('$lib/server_config.js');

		const user = upsertUserByEmail('q2@example.com');
		const site = createSite({ ownerUserId: user.user_id });

		const assetDir = siteAssetPath(site.site_id);
		mkdirSync(assetDir, { recursive: true });
		mkdirSync(join(assetDir, 'sub'), { recursive: true });
		writeFileSync(join(assetDir, 'a.bin'), Buffer.alloc(1000));
		writeFileSync(join(assetDir, 'sub', 'b.bin'), Buffer.alloc(2500));

		const status = await getSiteStorageStatus(site.site_id);
		expect(status.usedBytes).toBe(3500);
	});

	it('honors MEMORIAM_SITE_QUOTA_BYTES', async () => {
		process.env.MEMORIAM_SITE_QUOTA_BYTES = '5000';
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite } = await import('$lib/server/sites.js');
		const { getSiteStorageStatus } = await import('$lib/server/storage_quota.js');
		const { siteAssetPath } = await import('$lib/server_config.js');

		const user = upsertUserByEmail('q3@example.com');
		const site = createSite({ ownerUserId: user.user_id });

		const assetDir = siteAssetPath(site.site_id);
		mkdirSync(assetDir, { recursive: true });
		writeFileSync(join(assetDir, 'a.bin'), Buffer.alloc(5500));

		const status = await getSiteStorageStatus(site.site_id);
		expect(status.usedBytes).toBe(5500);
		expect(status.quotaBytes).toBe(5000);
		expect(status.over).toBe(true);

		delete process.env.MEMORIAM_SITE_QUOTA_BYTES;
	});
});

describe('visibility', () => {
	it('private site is invisible to non-members via resolveSiteIdFromUrl indirection', async () => {
		// The hooks-level gating sets locals.siteId = null for non-members of
		// private sites. resolveSiteIdFromUrl itself doesn't know about the
		// user; the gate lives in hooks.server.js. Here we just verify the
		// helper modules used by the gate behave as expected.
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const { createSite, getSite, getSiteMember } = await import('$lib/server/sites.js');

		const owner = upsertUserByEmail('owner@example.com');
		const stranger = upsertUserByEmail('stranger@example.com');
		const site = createSite({ ownerUserId: owner.user_id, visibility: 'private' });

		expect(getSite(site.site_id)?.visibility).toBe('private');
		expect(getSiteMember(site.site_id, owner.user_id)?.role).toBe('owner');
		expect(getSiteMember(site.site_id, stranger.user_id)).toBeNull();
	});
});
