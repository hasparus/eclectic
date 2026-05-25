import { error, json } from '@sveltejs/kit';
import { VARIANT_WIDTHS_SET } from '$lib/config.js';
import { asset_exists, write_variant } from '$lib/server/asset_storage.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, locals }) {
	if (!locals.is_admin) {
		error(401, 'Authentication required');
	}

	const site_id = locals.site_id;
	const { asset_id } = params;

	if (!asset_id || asset_id.includes('..') || asset_id.includes('/')) {
		error(400, 'Invalid asset id');
	}

	if (!asset_exists(site_id, asset_id)) {
		error(404, 'Asset not found');
	}

	const content_type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (content_type !== 'image/webp') {
		error(400, 'Variant must be image/webp');
	}

	const width_str = request.headers.get('x-variant-width');
	if (!width_str) {
		error(400, 'Missing X-Variant-Width header');
	}

	const width = parseInt(width_str, 10);
	if (!Number.isFinite(width) || width <= 0) {
		error(400, 'Invalid X-Variant-Width value');
	}

	if (!VARIANT_WIDTHS_SET.has(width)) {
		error(400, `Width ${width} is not an allowed variant width`);
	}

	if (!request.body) {
		error(400, 'Empty request body');
	}

	let bytes_written = 0;
	try {
		const result = await write_variant(site_id, asset_id, width, request.body);
		bytes_written = result.bytes_written;
	} catch (err) {
		console.error('Failed to write variant to disk:', err);
		error(500, 'Failed to store variant');
	}

	if (bytes_written === 0) {
		error(400, 'Empty variant data');
	}

	const variant = `w${width}.webp`;
	return json({ ok: true, variant });
}
