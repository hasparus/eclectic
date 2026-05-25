import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || 'data';

/**
 * Per-site data directory. Each site (one memorial = one tenant) gets its
 * own subdirectory containing the SQLite database and an `assets/`
 * directory.
 *
 * @param {string} site_id
 * @returns {string}
 */
export function site_data_dir(site_id) {
	return join(DATA_DIR, 'sites', site_id);
}

/**
 * @param {string} site_id
 * @returns {string}
 */
export function site_db_path(site_id) {
	return join(site_data_dir(site_id), 'db.sqlite3');
}

/**
 * @param {string} site_id
 * @returns {string}
 */
export function site_asset_path(site_id) {
	return join(site_data_dir(site_id), 'assets');
}

/**
 * Resolve the site id for a request. Phase 1 placeholder: returns a single
 * "default" site so the upstream single-tenant deployment shape keeps
 * working. Phase 2 replaces this with subdomain/custom-domain resolution
 * (see PLAN.md).
 *
 * @param {URL} _url
 * @returns {string}
 */
export function resolve_site_id(_url) {
	return process.env.MEMORIAM_DEFAULT_SITE_ID || 'default';
}

/**
 * @param {string} site_id
 * @returns {boolean}
 */
export function is_valid_site_id(site_id) {
	return /^[a-zA-Z0-9_-]{1,64}$/.test(site_id);
}
