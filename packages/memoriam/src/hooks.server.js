import { env } from '$env/dynamic/private';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { resolveSiteIdFromUrl } from '$lib/server/site_resolution.js';
import { getDb } from '$lib/server/db.js';
import {
	platformSessionCookieName,
	getPlatformSession,
	deletePlatformSession,
	extendPlatformSession,
	clearPlatformSessionCookie,
	setPlatformSessionCookie
} from '$lib/server/sessions.js';
import { getUser } from '$lib/server/users.js';
import { userCanEditSite } from '$lib/server/sites.js';
import { ensureDefaultSite } from '$lib/server/seed.js';

/** @type {import('@sveltejs/kit').ServerInit} */
export async function init() {
	// Eagerly initialize the platform DB so its migrations run at startup.
	// Per-site DBs still migrate lazily on first getDb(siteId) call.
	getPlatformDb();

	// In dev / single-tenant deployments, ensure the configured default
	// site exists. Idempotent — no-op if the site is already there.
	if (env.MEMORIAM_DEFAULT_SITE_ID) {
		ensureDefaultSite();
	}
}

/** @type {import('@sveltejs/kit').Handle} */
export const handle = async ({ event, resolve }) => {
	event.locals.platformDb = getPlatformDb();
	event.locals.siteId = null;
	event.locals.db = null;
	event.locals.userId = null;
	event.locals.userEmail = null;
	event.locals.isAdmin = false;

	// 1. Resolve site from URL (custom domain → subdomain → fallback).
	const siteId = resolveSiteIdFromUrl(event.url);
	if (siteId) {
		event.locals.siteId = siteId;
		event.locals.db = getDb(siteId);
	}

	// 2. Read the platform session cookie and resolve user.
	const sessionId = event.cookies.get(platformSessionCookieName);
	if (sessionId) {
		const session = getPlatformSession(sessionId);
		if (!session) {
			clearPlatformSessionCookie(event.cookies);
		} else if (session.expires <= Math.floor(Date.now() / 1000)) {
			deletePlatformSession(sessionId);
			clearPlatformSessionCookie(event.cookies);
		} else {
			const user = getUser(session.user_id);
			if (!user) {
				deletePlatformSession(sessionId);
				clearPlatformSessionCookie(event.cookies);
			} else {
				event.locals.userId = user.user_id;
				event.locals.userEmail = user.email;
				extendPlatformSession(sessionId);
				setPlatformSessionCookie(event.cookies, sessionId);
			}
		}
	}

	// 3. Compute isAdmin for the resolved site.
	if (event.locals.siteId && event.locals.userId) {
		event.locals.isAdmin = userCanEditSite(event.locals.siteId, event.locals.userId);
	}

	const response = await resolve(event);
	return response;
};
