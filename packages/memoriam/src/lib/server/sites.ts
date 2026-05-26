import { customAlphabet } from 'nanoid';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { getDb } from '$lib/server/db.js';
import { isValidSiteId } from '$lib/server_config.js';

const siteIdAlphabet = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

export interface Site {
	site_id: string;
	owner_user_id: string;
	display_name: string | null;
	visibility: 'public' | 'unlisted' | 'private';
	created_at: string;
	updated_at: string;
}

export interface SiteMember {
	site_id: string;
	user_id: string;
	role: 'owner' | 'editor' | 'viewer';
	created_at: string;
}

export interface CreateSiteInput {
	ownerUserId: string;
	displayName?: string;
	preferredSiteId?: string;
	visibility?: 'public' | 'unlisted' | 'private';
}

/**
 * Create a new site:
 *   1. Allocate a site_id (use preferredSiteId if available, otherwise a
 *      generated nanoid).
 *   2. Insert rows in the platform DB: `sites` and `site_members`.
 *   3. Open the per-site DB, which runs the per-site initial migration
 *      and seeds nav/footer/home page.
 *
 * Returns the created site row.
 */
export function createSite(input: CreateSiteInput): Site {
	const platform = getPlatformDb();
	const now = new Date().toISOString();

	// Verify the owner exists.
	const owner = platform
		.prepare('SELECT user_id FROM users WHERE user_id = ?')
		.get(input.ownerUserId) as { user_id: string } | undefined;
	if (!owner) {
		throw new Error(`User ${input.ownerUserId} not found`);
	}

	// Allocate a site_id. Prefer the caller's choice; otherwise generate
	// and retry until we find one that's free.
	let siteId = input.preferredSiteId ?? siteIdAlphabet();
	if (!isValidSiteId(siteId)) {
		throw new Error(`Invalid site id: ${siteId}`);
	}
	for (let attempt = 0; attempt < 5; attempt++) {
		const exists = platform
			.prepare('SELECT 1 FROM sites WHERE site_id = ?')
			.get(siteId) as { 1: number } | undefined;
		if (!exists) break;
		if (input.preferredSiteId) {
			throw new Error(`Site id ${input.preferredSiteId} already taken`);
		}
		siteId = siteIdAlphabet();
	}

	const visibility = input.visibility ?? 'public';

	platform.exec('BEGIN IMMEDIATE');
	try {
		platform
			.prepare(
				`INSERT INTO sites (site_id, owner_user_id, display_name, visibility, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(siteId, input.ownerUserId, input.displayName ?? null, visibility, now, now);

		platform
			.prepare(
				`INSERT INTO site_members (site_id, user_id, role, created_at)
				 VALUES (?, ?, 'owner', ?)`
			)
			.run(siteId, input.ownerUserId, now);

		platform.exec('COMMIT');
	} catch (err) {
		platform.exec('ROLLBACK');
		throw err;
	}

	// Open the per-site DB; this runs the initial migration which seeds
	// nav, footer, and the home page.
	getDb(siteId);

	return {
		site_id: siteId,
		owner_user_id: input.ownerUserId,
		display_name: input.displayName ?? null,
		visibility,
		created_at: now,
		updated_at: now
	};
}

export function getSite(siteId: string): Site | null {
	const row = getPlatformDb()
		.prepare(
			`SELECT site_id, owner_user_id, display_name, visibility, created_at, updated_at
			 FROM sites WHERE site_id = ?`
		)
		.get(siteId) as Site | undefined;
	return row ?? null;
}

export function getSiteMember(siteId: string, userId: string): SiteMember | null {
	const row = getPlatformDb()
		.prepare(
			`SELECT site_id, user_id, role, created_at FROM site_members
			 WHERE site_id = ? AND user_id = ?`
		)
		.get(siteId, userId) as SiteMember | undefined;
	return row ?? null;
}

/**
 * Can the user edit / save content on this site?  Owners and editors yes,
 * viewers and non-members no.
 */
export function userCanEditSite(siteId: string, userId: string | null): boolean {
	if (!userId) return false;
	const member = getSiteMember(siteId, userId);
	return !!member && (member.role === 'owner' || member.role === 'editor');
}

/**
 * Whether a site is reachable by unauthenticated visitors. `public` is
 * always reachable; `unlisted` is reachable with the link but not listed
 * publicly; `private` requires membership.
 */
export function siteIsViewableByPublic(visibility: Site['visibility']): boolean {
	return visibility === 'public' || visibility === 'unlisted';
}
