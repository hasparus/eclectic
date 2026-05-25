import { json, error } from '@sveltejs/kit';
import { delete_asset, asset_exists } from '$lib/server/asset_storage.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, locals }) {
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

	await delete_asset(site_id, asset_id);
	return json({ ok: true });
}
