import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSite, getSiteMember } from '$lib/server/sites.js';
import { resolveShortCode } from '$lib/server/short_codes.js';
import { generateQrSvg } from '$lib/server/qr.js';
import { generateQrPdf, QR_PDF_PRESETS, type QrPdfSize } from '$lib/server/qr_pdf.js';
import logoSvg from '$lib/qr-logo.svg?raw';
import type { RequestHandler } from './$types';

/**
 * Render the QR code for a short code, member-gated. The short code
 * itself doesn't carry any secret (it's printable on a grave) but
 * the QR endpoint is gated so a stranger can't enumerate which codes
 * resolve to which sites.
 *
 * Default response is SVG (one optimised `<path>` per module set —
 * prints crisply, tiny file). `?format=pdf&size=card|plaque|headstone`
 * returns a print-ready PDF carrying the QR at the preset's physical
 * size with the short URL printed below as a human-readable fallback
 * for scanners that fail.
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

	if (url.searchParams.get('format') === 'pdf') {
		const sizeParam = url.searchParams.get('size') ?? 'plaque';
		if (!(sizeParam in QR_PDF_PRESETS)) error(400, `Unknown size: ${sizeParam}`);
		const size = sizeParam as QrPdfSize;
		const site = getSite(siteId);
		const pdf = await generateQrPdf({
			qrSvg: svg,
			url: target,
			size,
			title: site?.display_name ?? undefined
		});
		// `Buffer` isn't structurally a `BodyInit` in @types/node, but
		// it's a `Uint8Array` subclass at runtime and fetch accepts it.
		// `new Uint8Array(buffer)` shares the underlying memory.
		return new Response(new Uint8Array(pdf), {
			headers: {
				'Content-Type': 'application/pdf',
				// Filename hints the engraver at the intended size when
				// they open it weeks later.
				'Content-Disposition': `attachment; filename="${code}-${size}.pdf"`,
				// The title is read from the (mutable) site row, so don't
				// cache long. Short cache still helps reload flicker.
				'Cache-Control': 'private, max-age=60'
			}
		});
	}

	return new Response(svg, {
		headers: {
			'Content-Type': 'image/svg+xml; charset=utf-8',
			// Short codes are permanent and the SVG rendering is
			// deterministic per (code, logo flag) — cache aggressively.
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
};
