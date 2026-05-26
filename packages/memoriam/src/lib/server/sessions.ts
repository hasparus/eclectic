import { randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { getPlatformDb } from '$lib/server/platform_db.js';

export const platformSessionCookieName = 'mm_session';
export const sessionDurationSeconds = 14 * 24 * 60 * 60;

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function nowIso(): string {
	return new Date().toISOString();
}

function generateSessionId(): string {
	return randomBytes(32).toString('base64url');
}

export interface PlatformSession {
	session_id: string;
	user_id: string;
	expires: number;
	created_at: string;
}

export function createPlatformSession(userId: string): PlatformSession {
	const sessionId = generateSessionId();
	const expires = nowSeconds() + sessionDurationSeconds;
	const createdAt = nowIso();

	getPlatformDb()
		.prepare(
			`INSERT INTO platform_sessions (session_id, user_id, expires, created_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(sessionId, userId, expires, createdAt);

	return { session_id: sessionId, user_id: userId, expires, created_at: createdAt };
}

export function getPlatformSession(sessionId: string): PlatformSession | null {
	const row = getPlatformDb()
		.prepare(
			`SELECT session_id, user_id, expires, created_at FROM platform_sessions
			 WHERE session_id = ?`
		)
		.get(sessionId) as PlatformSession | undefined;
	return row ?? null;
}

export function deletePlatformSession(sessionId: string): void {
	getPlatformDb()
		.prepare('DELETE FROM platform_sessions WHERE session_id = ?')
		.run(sessionId);
}

export function extendPlatformSession(sessionId: string): number {
	const expires = nowSeconds() + sessionDurationSeconds;
	getPlatformDb()
		.prepare('UPDATE platform_sessions SET expires = ? WHERE session_id = ?')
		.run(expires, sessionId);
	return expires;
}

export function setPlatformSessionCookie(cookies: Cookies, sessionId: string): void {
	cookies.set(platformSessionCookieName, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: sessionDurationSeconds
	});
}

export function clearPlatformSessionCookie(cookies: Cookies): void {
	cookies.set(platformSessionCookieName, '', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: env.NODE_ENV === 'production',
		maxAge: 0
	});
}
