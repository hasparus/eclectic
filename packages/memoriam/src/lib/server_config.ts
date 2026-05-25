import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || 'data';

/**
 * Per-site data directory. Each site (one memorial = one tenant) gets
 * its own subdirectory containing the SQLite database and an `assets/`
 * directory.
 */
export function siteDataDir(siteId: string): string {
	return join(DATA_DIR, 'sites', siteId);
}

export function siteDbPath(siteId: string): string {
	return join(siteDataDir(siteId), 'db.sqlite3');
}

export function siteAssetPath(siteId: string): string {
	return join(siteDataDir(siteId), 'assets');
}

/**
 * Resolve the site id for a request. Phase 1 placeholder: returns a
 * single "default" site so the upstream single-tenant deployment
 * shape keeps working. Phase 2 replaces this with subdomain /
 * custom-domain resolution (see PLAN.md).
 */
export function resolveSiteId(_url: URL): string {
	return process.env.MEMORIAM_DEFAULT_SITE_ID || 'default';
}

export function isValidSiteId(siteId: string): boolean {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(siteId);
}
