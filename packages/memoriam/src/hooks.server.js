import { env } from '$env/dynamic/private';
import {
	adminSessionCookieName,
	clearAdminSessionCookie,
	getSessionExpiresAt,
	setAdminSessionCookie
} from '$lib/server/auth.js';
import { resolveSiteId } from '$lib/server_config.js';

/** @type {import('@sveltejs/kit').ServerInit} */
export async function init() {
	if (!env.VERCEL && !env.ADMIN_PASSWORD) {
		throw new Error('ADMIN_PASSWORD must be set');
	}

	// Migrations run lazily on first getDb(siteId) per site (see
	// $lib/server/db.ts). No eager migration here — there is no longer a
	// single application database to migrate up front.
}

/** @type {import('@sveltejs/kit').Handle} */
export const handle = async ({ event, resolve }) => {
	event.locals.isAdmin = false;

	if (env.VERCEL) {
		return resolve(event);
	}

	const siteId = resolveSiteId(event.url);
	event.locals.siteId = siteId;

	const { getDb } = await import('$lib/server/db.js');
	const db = getDb(siteId);
	event.locals.db = db;

	const sessionId = event.cookies.get(adminSessionCookieName);

	if (sessionId) {
		const row = /** @type {{ expires: number } | undefined} */ (
			db.prepare('SELECT expires FROM sessions WHERE session_id = ?').get(sessionId)
		);

		if (!row) {
			clearAdminSessionCookie(event.cookies);
		} else if (row.expires <= Math.floor(Date.now() / 1000)) {
			db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
			clearAdminSessionCookie(event.cookies);
		} else {
			db.prepare('UPDATE sessions SET expires = ? WHERE session_id = ?').run(
				getSessionExpiresAt(),
				sessionId
			);
			setAdminSessionCookie(event.cookies, sessionId);
			event.locals.isAdmin = true;
		}
	}

	const response = await resolve(event);
	return response;
};
