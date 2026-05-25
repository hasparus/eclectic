import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type { DatabaseSync } from 'node:sqlite';

export const adminSessionCookieName = 'ew_admin_session';
export const sessionDurationSeconds = 14 * 24 * 60 * 60;

/**
 * Constant-time equality check for short secrets (passwords, tokens).
 * Pads the shorter input so the comparison time is independent of
 * length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf8');
	const bBuf = Buffer.from(b, 'utf8');
	const len = Math.max(aBuf.length, bBuf.length);
	const aPadded = Buffer.alloc(len);
	const bPadded = Buffer.alloc(len);
	aBuf.copy(aPadded);
	bBuf.copy(bPadded);
	const equalBytes = timingSafeEqual(aPadded, bPadded);
	return equalBytes && aBuf.length === bBuf.length;
}

export function getRequiredAdminPassword(): string {
	const adminPassword = env.ADMIN_PASSWORD;
	if (!adminPassword) {
		throw new Error('ADMIN_PASSWORD must be set');
	}
	return adminPassword;
}

export function getSessionExpiresAt(): number {
	return Math.floor(Date.now() / 1000) + sessionDurationSeconds;
}

export function clearAdminSessionCookie(cookies: Cookies): void {
	cookies.set(adminSessionCookieName, '', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: 0
	});
}

export function setAdminSessionCookie(cookies: Cookies, sessionId: string): void {
	cookies.set(adminSessionCookieName, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: sessionDurationSeconds
	});
}

export function deleteSession(db: DatabaseSync, sessionId: string): void {
	db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

export function requireAdminSession(locals: { isAdmin?: boolean }): true {
	if (!locals.isAdmin) {
		throw new Error('Unauthorized');
	}
	return true;
}
