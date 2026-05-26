import { error, json } from '@sveltejs/kit';
import { VARIANT_WIDTHS_SET } from '$lib/config.js';
import { assetExists, writeVariant } from '$lib/server/asset_storage.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, locals }) {
	if (!locals.siteId) {
		error(404, 'Site not found');
	}
	if (!locals.isAdmin) {
		error(401, 'Authentication required');
	}

	const siteId = locals.siteId;
	const { asset_id: assetId } = params;

	if (!assetId || assetId.includes('..') || assetId.includes('/')) {
		error(400, 'Invalid asset id');
	}

	if (!assetExists(siteId, assetId)) {
		error(404, 'Asset not found');
	}

	const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (contentType !== 'image/webp') {
		error(400, 'Variant must be image/webp');
	}

	const widthStr = request.headers.get('x-variant-width');
	if (!widthStr) {
		error(400, 'Missing X-Variant-Width header');
	}

	const width = parseInt(widthStr, 10);
	if (!Number.isFinite(width) || width <= 0) {
		error(400, 'Invalid X-Variant-Width value');
	}

	if (!VARIANT_WIDTHS_SET.has(width)) {
		error(400, `Width ${width} is not an allowed variant width`);
	}

	if (!request.body) {
		error(400, 'Empty request body');
	}

	let bytesWritten = 0;
	try {
		const result = await writeVariant(siteId, assetId, width, request.body);
		bytesWritten = result.bytesWritten;
	} catch (err) {
		console.error('Failed to write variant to disk:', err);
		error(500, 'Failed to store variant');
	}

	if (bytesWritten === 0) {
		error(400, 'Empty variant data');
	}

	const variant = `w${width}.webp`;
	return json({ ok: true, variant });
}
