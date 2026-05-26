import { randomBytes } from 'node:crypto';
import { getPlatformDb } from '$lib/server/platform_db.js';

const MAGIC_LINK_TTL_SECONDS = 15 * 60;

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

function nowIso(): string {
	return new Date().toISOString();
}

function generateToken(): string {
	// URL-safe random — 32 bytes is 256 bits of entropy, plenty for a
	// short-lived bearer token.
	return randomBytes(32).toString('base64url');
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export interface MagicLinkIssued {
	token: string;
	email: string;
	expiresAt: number;
}

/**
 * Issue a new magic-link token for an email. Stores the token in
 * `magic_link_tokens` and returns it. The caller is responsible for
 * emailing the user a URL like `/auth/magic?token=<token>`.
 *
 * In dev (no email integration yet) the magic link is logged to stdout
 * by hooks / API endpoints.
 */
export function issueMagicLink(email: string): MagicLinkIssued {
	const normalized = normalizeEmail(email);
	if (!normalized.includes('@')) {
		throw new Error('Invalid email');
	}

	const token = generateToken();
	const expiresAt = nowSeconds() + MAGIC_LINK_TTL_SECONDS;

	getPlatformDb()
		.prepare(
			`INSERT INTO magic_link_tokens (token, email, expires, created_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(token, normalized, expiresAt, nowIso());

	return { token, email: normalized, expiresAt };
}

export interface ConsumeMagicLinkResult {
	ok: boolean;
	reason?: 'unknown' | 'expired' | 'already_consumed';
	email?: string;
}

/**
 * Validate and consume a magic-link token. Returns the email it was
 * issued for, or an error reason. Single-use: once consumed_at is set,
 * subsequent attempts return already_consumed.
 */
export function consumeMagicLink(token: string): ConsumeMagicLinkResult {
	const db = getPlatformDb();
	const row = db
		.prepare(
			`SELECT email, expires, consumed_at FROM magic_link_tokens WHERE token = ?`
		)
		.get(token) as { email: string; expires: number; consumed_at: string | null } | undefined;

	if (!row) return { ok: false, reason: 'unknown' };
	if (row.consumed_at) return { ok: false, reason: 'already_consumed' };
	if (row.expires <= nowSeconds()) return { ok: false, reason: 'expired' };

	db.prepare('UPDATE magic_link_tokens SET consumed_at = ? WHERE token = ?').run(nowIso(), token);
	return { ok: true, email: row.email };
}
