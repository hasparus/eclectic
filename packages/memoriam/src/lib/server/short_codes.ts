import { customAlphabet } from 'nanoid';
import { getPlatformDb } from '$lib/server/platform_db.js';

// Short codes are short, URL-safe, case-sensitive. 11 chars of a 62-char
// alphabet ≈ 65 bits of entropy — enough that random guessing is
// infeasible and the printed code stays short enough for engraving.
const shortCodeAlphabet = customAlphabet(
	'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789',
	11
);

export interface ShortCode {
	code: string;
	site_id: string;
	target_path: string;
	created_at: string;
}

export interface ResolvedShortCode {
	site_id: string;
	target_path: string;
}

/**
 * Issue a permanent short code pointing at a (site, path). Codes are
 * forever — once issued they must keep resolving. Caller is expected to
 * persist what they did with the code (e.g. log to short_code_uses).
 */
export function issueShortCode(siteId: string, targetPath: string = '/'): ShortCode {
	const db = getPlatformDb();
	const createdAt = new Date().toISOString();

	for (let attempt = 0; attempt < 5; attempt++) {
		const code = shortCodeAlphabet();
		try {
			db.prepare(
				`INSERT INTO short_codes (code, site_id, target_path, created_at) VALUES (?, ?, ?, ?)`
			).run(code, siteId, targetPath, createdAt);
			return { code, site_id: siteId, target_path: targetPath, created_at: createdAt };
		} catch (err) {
			// Almost certainly a unique-constraint collision — retry with a
			// fresh code. Re-throw anything else.
			if (!String(err).includes('UNIQUE')) throw err;
		}
	}
	throw new Error('Failed to allocate a unique short code after 5 attempts');
}

export function resolveShortCode(code: string): ResolvedShortCode | null {
	const row = getPlatformDb()
		.prepare(`SELECT site_id, target_path FROM short_codes WHERE code = ?`)
		.get(code) as ResolvedShortCode | undefined;
	return row ?? null;
}
