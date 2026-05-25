import { json, error } from '@sveltejs/kit';
import { assetExists, writeAsset, deleteAsset } from '$lib/server/asset_storage.js';

/** Map content types to stored file extensions */
const CONTENT_TYPE_TO_EXT = /** @type {Record<string, string>} */ ({
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/svg+xml': 'svg',
	'video/mp4': 'mp4',
	'video/webm': 'webm'
});

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, locals }) {
	if (!locals.isAdmin) {
		error(401, 'Authentication required');
	}

	const siteId = locals.siteId;

	const contentTypeRaw = request.headers.get('content-type') ?? '';
	const contentType = contentTypeRaw.split(';')[0].trim().toLowerCase();

	const ext = CONTENT_TYPE_TO_EXT[contentType];
	if (!ext) {
		error(400, `Unsupported content type: ${contentType}. Expected image/webp, image/gif, image/svg+xml, video/mp4, or video/webm.`);
	}

	const claimedHash = request.headers.get('x-content-hash');
	if (!claimedHash || !/^[a-f0-9]{64}$/.test(claimedHash)) {
		error(400, 'Missing or invalid X-Content-Hash header (expected SHA-256 hex)');
	}

	const width = parseInt(request.headers.get('x-asset-width') ?? '', 10);
	const height = parseInt(request.headers.get('x-asset-height') ?? '', 10);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		error(400, 'Missing or invalid X-Asset-Width / X-Asset-Height headers');
	}

	const assetId = `${claimedHash}.${ext}`;

	// Deduplication: if the file already exists, skip the upload.
	if (assetExists(siteId, assetId)) {
		if (request.body) {
			const reader = request.body.getReader();
			while (!(await reader.read()).done) { /* drain */ }
		}

		return json({ asset_id: assetId, width, height, deduplicated: true });
	}

	if (!request.body) {
		error(400, 'Empty request body');
	}

	let bytesWritten = 0;
	let actualHash = '';
	try {
		const result = await writeAsset(siteId, assetId, request.body);
		bytesWritten = result.bytesWritten;
		actualHash = result.sha256Hex;
	} catch (err) {
		await deleteAsset(siteId, assetId).catch(() => {});
		console.error('Failed to write asset to disk:', err);
		error(500, 'Failed to store asset');
	}

	if (bytesWritten === 0) {
		await deleteAsset(siteId, assetId).catch(() => {});
		error(400, 'Empty file');
	}

	if (actualHash !== claimedHash) {
		await deleteAsset(siteId, assetId).catch(() => {});
		error(400, 'Body does not match X-Content-Hash');
	}

	return json({ asset_id: assetId, width, height, deduplicated: false });
}
