import { error, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { resolveShortCode } from '$lib/server/short_codes.js';
import { getPlatformDb } from '$lib/server/platform_db.js';
import type { RequestHandler } from './$types';

/**
 * Permanent short-code redirect endpoint. Deliberately small and
 * dependency-light — engraved QR codes resolve through here for
 * decades, so this handler should be portable to a tiny standalone
 * worker if we ever move it off the main app (Cloudflare Worker / etc).
 *
 * Resolution preference, in order:
 *   1. Custom domain on the site (if any).
 *   2. `<site_id>.<MEMORIAM_HOST_SUFFIX>` if MEMORIAM_HOST_SUFFIX is set.
 *   3. Fallback: keep the request host, prepend the site_id as a path
 *      prefix (`/<site_id>/<target_path>`). Poor UX but never breaks.
 */
export const GET: RequestHandler = ({ params, url }) => {
	const code = params.code;
	if (!code) {
		error(400, 'Missing short code');
	}

	const resolved = resolveShortCode(code);
	if (!resolved) {
		error(404, 'Short code not found');
	}

	const targetPath = resolved.target_path.startsWith('/')
		? resolved.target_path
		: `/${resolved.target_path}`;

	const customDomain = getPlatformDb()
		.prepare(`SELECT domain FROM domains WHERE site_id = ? LIMIT 1`)
		.get(resolved.site_id) as { domain: string } | undefined;

	if (customDomain) {
		throw redirect(301, `https://${customDomain.domain}${targetPath}`);
	}

	const hostSuffix = env.MEMORIAM_HOST_SUFFIX;
	if (hostSuffix) {
		throw redirect(301, `${url.protocol}//${resolved.site_id}.${hostSuffix}${targetPath}`);
	}

	// Last resort — keep current host, prefix with site_id.
	throw redirect(301, `/${resolved.site_id}${targetPath}`);
};
