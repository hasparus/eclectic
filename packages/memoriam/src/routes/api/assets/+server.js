import { json, error } from '@sveltejs/kit';
import { asset_exists, write_asset, delete_asset } from '$lib/server/asset_storage.js';

/** Map content types to stored file extensions */
const CONTENT_TYPE_TO_EXT = {
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
	'video/mp4': 'mp4',
	'video/webm': 'webm'
};

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, locals }) {
	if (!locals.is_admin) {
		error(401, 'Authentication required');
	}

	const site_id = locals.site_id;

	const content_type_raw = request.headers.get('content-type') ?? '';
	const content_type = content_type_raw.split(';')[0].trim().toLowerCase();

	const ext = CONTENT_TYPE_TO_EXT[content_type];
	if (!ext) {
		error(400, `Unsupported content type: ${content_type}. Expected image/webp, image/gif, image/svg+xml, video/mp4, or video/webm.`);
	}

	const claimed_hash = request.headers.get('x-content-hash');
	if (!claimed_hash || !/^[a-f0-9]{64}$/.test(claimed_hash)) {
		error(400, 'Missing or invalid X-Content-Hash header (expected SHA-256 hex)');
	}

	const width = parseInt(request.headers.get('x-asset-width') ?? '', 10);
	const height = parseInt(request.headers.get('x-asset-height') ?? '', 10);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		error(400, 'Missing or invalid X-Asset-Width / X-Asset-Height headers');
	}

	const asset_id = `${claimed_hash}.${ext}`;

	// Deduplication: if the file already exists, skip the upload.
	if (asset_exists(site_id, asset_id)) {
		if (request.body) {
			const reader = request.body.getReader();
			while (!(await reader.read()).done) { /* drain */ }
		}

		return json({ asset_id, width, height, deduplicated: true });
	}

	if (!request.body) {
		error(400, 'Empty request body');
	}

	// Stream the request body directly to disk while hashing.
	let bytes_written = 0;
	let actual_hash = '';
	try {
		const result = await write_asset(site_id, asset_id, request.body);
		bytes_written = result.bytes_written;
		actual_hash = result.sha256_hex;
	} catch (err) {
		await delete_asset(site_id, asset_id).catch(() => {});
		console.error('Failed to write asset to disk:', err);
		error(500, 'Failed to store asset');
	}

	if (bytes_written === 0) {
		await delete_asset(site_id, asset_id).catch(() => {});
		error(400, 'Empty file');
	}

	// Verify that the bytes actually delivered match the claimed hash. If
	// they don't, the asset_id (derived from the claimed hash) does not
	// correspond to its content and dedupe is broken. Reject and clean up.
	if (actual_hash !== claimed_hash) {
		await delete_asset(site_id, asset_id).catch(() => {});
		error(400, 'Body does not match X-Content-Hash');
	}

	return json({ asset_id, width, height, deduplicated: false });
}
