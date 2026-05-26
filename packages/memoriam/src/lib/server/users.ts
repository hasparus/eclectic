import { customAlphabet } from 'nanoid';
import { getPlatformDb } from '$lib/server/platform_db.js';

const userIdAlphabet = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);

export interface User {
	user_id: string;
	email: string;
	display_name: string | null;
	created_at: string;
	updated_at: string;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function getUserByEmail(email: string): User | null {
	const row = getPlatformDb()
		.prepare(
			`SELECT user_id, email, display_name, created_at, updated_at
			 FROM users WHERE email = ?`
		)
		.get(normalizeEmail(email)) as User | undefined;
	return row ?? null;
}

export function getUser(userId: string): User | null {
	const row = getPlatformDb()
		.prepare(
			`SELECT user_id, email, display_name, created_at, updated_at
			 FROM users WHERE user_id = ?`
		)
		.get(userId) as User | undefined;
	return row ?? null;
}

/**
 * Create a user or return the existing one if email already exists. Used
 * by the magic-link consume flow.
 */
export function upsertUserByEmail(email: string): User {
	const normalized = normalizeEmail(email);
	const existing = getUserByEmail(normalized);
	if (existing) return existing;

	const userId = userIdAlphabet();
	const now = new Date().toISOString();
	getPlatformDb()
		.prepare(
			`INSERT INTO users (user_id, email, display_name, created_at, updated_at)
			 VALUES (?, ?, NULL, ?, ?)`
		)
		.run(userId, normalized, now, now);

	return {
		user_id: userId,
		email: normalized,
		display_name: null,
		created_at: now,
		updated_at: now
	};
}
