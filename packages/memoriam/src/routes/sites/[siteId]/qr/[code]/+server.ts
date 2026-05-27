import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSiteMember } from '$lib/server/sites.js';
import { resolveShortCode } from '$lib/server/short_codes.js';
import { generateQrSvg } from '$lib/server/qr.js';
import logoSvg from '$lib/qr-logo.svg?raw';
import type { RequestHandler } from './$types';

/**
 * Render the QR code for a short code as an SVG. Members of the
 * owning site can fetch it; the short code itself doesn't carry any
 * secret (it's printable on a grave) but the QR endpoint is gated so
 * a stranger can't enumerate which codes resolve to which sites.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const { siteId, code } = params;
	if (!siteId || !code) error(400, 'Missing site or code');

	if (!locals.userId) error(401, 'Sign in required');
	const member = getSiteMember(siteId, locals.userId);
	if (!member) error(403, 'Not a member of this site');

	const resolved = resolveShortCode(code);
	if (!resolved || resolved.site_id !== siteId) error(404, 'Short code not found');

	// Build the absolute URL the QR resolves to. Prefer ORIGIN env so
	// the link prints with the deploy's canonical host even when the
	// request came in over a private network.
	const origin = env.ORIGIN || url.origin;
	const target = `${origin.replace(/\/$/, '')}/r/${encodeURIComponent(code)}`;

	const withLogo = url.searchParams.get('logo') !== '0';
	const svg = await generateQrSvg(target, withLogo ? { logo: { svg: logoSvg } } : {});

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			// Short codes are permanent and the rendering is
			// deterministic per (code, logo flag) — cache aggressively.
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
