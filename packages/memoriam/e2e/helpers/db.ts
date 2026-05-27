import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

let cachedPath: string | null = null;
let cachedDb: DatabaseSync | null = null;

function platformDbPath(): string {
	if (cachedPath) return cachedPath;
	const dataDir = process.env.MEMORIAM_E2E_DATA_DIR;
	if (!dataDir) {
		throw new Error('MEMORIAM_E2E_DATA_DIR is not set; is playwright.config.ts being loaded?');
	}
	cachedPath = join(dataDir, '_platform.sqlite3');
	return cachedPath;
}

function db(): DatabaseSync {
	if (cachedDb) return cachedDb;
	cachedDb = new DatabaseSync(platformDbPath());
	cachedDb.exec('PRAGMA journal_mode=WAL');
	cachedDb.exec('PRAGMA busy_timeout=5000');
	return cachedDb;
}

/**
 * Wait up to `timeoutMs` for the platform DB file to exist (the dev
 * server creates it lazily on the first request handled by hooks).
 */
export async function awaitPlatformDb(timeoutMs = 10_000): Promise<void> {
	const fs = await import('node:fs/promises');
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			await fs.access(platformDbPath());
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error('platform DB never appeared at ' + platformDbPath());
}

/**
 * Read the latest unconsumed magic-link token for `email`. Tests use
 * this instead of intercepting real emails — the server logs to
 * stdout in dev too, but reading the DB is deterministic.
 */
export function latestMagicLinkToken(email: string): string {
	const row = db()
		.prepare(
			`SELECT token FROM magic_link_tokens
			 WHERE email = ? AND consumed_at IS NULL
			 ORDER BY created_at DESC LIMIT 1`
		)
		.get(email.trim().toLowerCase()) as { token: string } | undefined;
	if (!row) {
		throw new Error(`No outstanding magic-link token found for ${email}`);
	}
	return row.token;
}

/**
 * Poll for a magic-link token. The form submission writes the token
 * asynchronously, so a single read can race; loop briefly.
 */
export async function waitForMagicLinkToken(
	email: string,
	timeoutMs = 5_000
): Promise<string> {
	const start = Date.now();
	let lastErr: unknown;
	while (Date.now() - start < timeoutMs) {
		try {
			return latestMagicLinkToken(email);
		} catch (err) {
			lastErr = err;
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw lastErr ?? new Error(`Magic-link token for ${email} never appeared`);
}

/** Latest unconsumed invite token for an email. */
export function latestInviteToken(email: string): string {
	const row = db()
		.prepare(
			`SELECT invite_token FROM invites
			 WHERE email = ? AND accepted_at IS NULL
			 ORDER BY created_at DESC LIMIT 1`
		)
		.get(email.trim().toLowerCase()) as { invite_token: string } | undefined;
	if (!row) {
		throw new Error(`No outstanding invite token found for ${email}`);
	}
	return row.invite_token;
}

/** Direct read of the sites row for a given site_id. */
export function readSite(siteId: string): { display_name: string | null; visibility: string } | null {
	return (
		(db()
			.prepare(`SELECT display_name, visibility FROM sites WHERE site_id = ?`)
			.get(siteId) as { display_name: string | null; visibility: string } | undefined) ?? null
	);
}
