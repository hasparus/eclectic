import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'node:crypto';

export const admin_session_cookie_name = 'ew_admin_session';
export const session_duration_seconds = 14 * 24 * 60 * 60;

/**
 * Constant-time equality check for short secrets (passwords, tokens). Pads
 * the shorter input so the comparison time is independent of length.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constant_time_equal(a, b) {
	const a_buf = Buffer.from(a, 'utf8');
	const b_buf = Buffer.from(b, 'utf8');
	const len = Math.max(a_buf.length, b_buf.length);
	const a_padded = Buffer.alloc(len);
	const b_padded = Buffer.alloc(len);
	a_buf.copy(a_padded);
	b_buf.copy(b_padded);
	const equal_bytes = timingSafeEqual(a_padded, b_padded);
	return equal_bytes && a_buf.length === b_buf.length;
}

/**
 * @returns {string}
 */
export function get_required_admin_password() {
	const admin_password = env.ADMIN_PASSWORD;
	if (!admin_password) {
		throw new Error('ADMIN_PASSWORD must be set');
	}

	return admin_password;
}

/**
 * @returns {number}
 */
export function get_session_expires_at() {
	return Math.floor(Date.now() / 1000) + session_duration_seconds;
}

/**
 * @param {import('@sveltejs/kit').Cookies} cookies
 */
export function clear_admin_session_cookie(cookies) {
	cookies.set(admin_session_cookie_name, '', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: 0
	});
}

/**
 * @param {import('@sveltejs/kit').Cookies} cookies
 * @param {string} session_id
 */
export function set_admin_session_cookie(cookies, session_id) {
	cookies.set(admin_session_cookie_name, session_id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: session_duration_seconds
	});
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} session_id
 */
export function delete_session(db, session_id) {
	db.prepare('DELETE FROM sessions WHERE session_id = ?').run(session_id);
}

/**
 * @param {{ is_admin?: boolean }} locals
 * @returns {true}
 */
export function require_admin_session(locals) {
	if (!locals.is_admin) {
		throw new Error('Unauthorized');
	}

	return true;
}