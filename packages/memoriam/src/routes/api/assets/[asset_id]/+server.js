import { json, error } from '@sveltejs/kit';
import { deleteAsset, assetExists } from '$lib/server/asset_storage.js';

/** @type {import('./$types').RequestHandler} */
export async function DELETE({ params, locals }) {
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

	await deleteAsset(siteId, assetId);
	return json({ ok: true });
}
