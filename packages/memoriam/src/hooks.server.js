import { env } from '$env/dynamic/private';
import {
	admin_session_cookie_name,
	clear_admin_session_cookie,
	get_session_expires_at,
	set_admin_session_cookie
} from '$lib/server/auth.js';
import { resolve_site_id } from '$lib/server_config.js';

/** @type {import('@sveltejs/kit').ServerInit} */
export async function init() {
	if (!env.VERCEL && !env.ADMIN_PASSWORD) {
		throw new Error('ADMIN_PASSWORD must be set');
	}

	// Migrations run lazily on first get_db(site_id) per site (see
	// $lib/server/db.js). No eager migration here — there is no longer a
	// single application database to migrate up front.
}

/** @type {import('@sveltejs/kit').Handle} */
export const handle = async ({ event, resolve }) => {
	event.locals.is_admin = false;

	if (env.VERCEL) {
		return resolve(event);
	}

	const site_id = resolve_site_id(event.url);
	event.locals.site_id = site_id;

	const { get_db } = await import('$lib/server/db.js');
	const db = get_db(site_id);
	event.locals.db = db;

	const session_id = event.cookies.get(admin_session_cookie_name);

	if (session_id) {
		const row = /** @type {{ expires: number } | undefined } */ (
			db.prepare('SELECT expires FROM sessions WHERE session_id = ?').get(session_id)
		);

		if (!row) {
			clear_admin_session_cookie(event.cookies);
		} else if (row.expires <= Math.floor(Date.now() / 1000)) {
			db.prepare('DELETE FROM sessions WHERE session_id = ?').run(session_id);
			clear_admin_session_cookie(event.cookies);
		} else {
			db.prepare('UPDATE sessions SET expires = ? WHERE session_id = ?').run(
				get_session_expires_at(),
				session_id
			);
			set_admin_session_cookie(event.cookies, session_id);
			event.locals.is_admin = true;
		}
	}

	const response = await resolve(event);
	return response;
};
