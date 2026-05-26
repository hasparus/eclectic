import { env } from '$env/dynamic/private';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { upsertUserByEmail } from '$lib/server/users.js';
import { createSite, getSite } from '$lib/server/sites.js';
import { isValidSiteId } from '$lib/server_config.js';

/**
 * Seed a default user + site so a fresh install (or `SEED=1` wipe) has
 * something to render. Idempotent: skips if the site already exists.
 *
 * Driven by env:
 *   - MEMORIAM_DEFAULT_SITE_ID — the site_id to create (default: 'default')
 *   - MEMORIAM_DEFAULT_USER_EMAIL — owner email (default: 'admin@memoriam.local')
 */
export function ensureDefaultSite(): void {
	const siteId = env.MEMORIAM_DEFAULT_SITE_ID || 'default';
	if (!isValidSiteId(siteId)) {
		console.warn(`[seed] Invalid MEMORIAM_DEFAULT_SITE_ID '${siteId}'; skipping seed.`);
		return;
	}

	if (getSite(siteId)) {
		return;
	}

	const email = env.MEMORIAM_DEFAULT_USER_EMAIL || 'admin@memoriam.local';
	const user = upsertUserByEmail(email);
	createSite({
		ownerUserId: user.user_id,
		preferredSiteId: siteId,
		displayName: 'Default site'
	});

	console.log(
		`[seed] Created default site '${siteId}' owned by ${email}. Use the magic-link flow with that email to sign in.`
	);
	// Touch the platform DB explicitly so the log makes it clear the seed ran.
	void getPlatformDb();
}
