import { env } from '$env/dynamic/private';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { isValidSiteId } from '$lib/server_config.js';

const MEMORIAM_HOST_SUFFIX = env.MEMORIAM_HOST_SUFFIX || 'memoriam.app';

/**
 * Resolve the site_id for an incoming request, in order:
 *   1. Custom domain (entire hostname is registered in the `domains` table)
 *   2. Subdomain on the platform host (`<site_id>.memoriam.app`)
 *   3. The default site, if MEMORIAM_DEFAULT_SITE_ID is set (dev / single-tenant)
 *   4. null — request is not site-scoped (e.g. /signin, /sites)
 *
 * Returns null only when none of the above match. Callers must handle
 * site_id === null on routes that are platform-level only.
 */
export function resolveSiteIdFromUrl(url: URL): string | null {
	const host = url.hostname.toLowerCase();
	const db = getPlatformDb();

	// 1. Custom domain
	const domainRow = db
		.prepare('SELECT site_id FROM domains WHERE domain = ?')
		.get(host) as { site_id: string } | undefined;
	if (domainRow) return domainRow.site_id;

	// 2. Subdomain on platform host
	const suffix = '.' + MEMORIAM_HOST_SUFFIX;
	if (host.endsWith(suffix)) {
		const candidate = host.slice(0, -suffix.length);
		if (candidate && isValidSiteId(candidate)) {
			const exists = db
				.prepare('SELECT 1 FROM sites WHERE site_id = ?')
				.get(candidate) as { 1: number } | undefined;
			if (exists) return candidate;
		}
	}

	// 3. Default site fallback (single-tenant dev, etc)
	const fallback = env.MEMORIAM_DEFAULT_SITE_ID;
	if (fallback && isValidSiteId(fallback)) {
		const exists = db
			.prepare('SELECT 1 FROM sites WHERE site_id = ?')
			.get(fallback) as { 1: number } | undefined;
		if (exists) return fallback;
	}

	return null;
}
