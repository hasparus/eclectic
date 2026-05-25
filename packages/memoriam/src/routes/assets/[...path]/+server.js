import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import {
	assetExists,
	assetSize,
	createAssetReadStream,
	createVariantReadStream,
	variantPath
} from '$lib/server/asset_storage.js';

/** Map file extensions to MIME types */
const EXT_TO_MIME = /** @type {Record<string, string>} */ ({
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm'
});

/**
 * Convert a Node.js Readable stream to a Web ReadableStream.
 * @param {import('node:stream').Readable} nodeStream
 * @returns {ReadableStream<Uint8Array>}
 */
function toWebStream(nodeStream) {
	return /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(nodeStream));
}

/**
 * Extract the first 8 hex characters from an asset id for Content-Disposition filename.
 * @param {string} assetId
 * @param {string} ext
 * @returns {string}
 */
function shortFilename(assetId, ext) {
	return `${assetId.slice(0, 8)}${ext}`;
}

/**
 * Parse an HTTP Range header for a single byte range. Returns a tagged
 * union so callers can distinguish "no range" (serve whole file),
 * "unsatisfiable" (respond 416), and "ok" (respond 206 with the byte
 * window).
 *
 * @typedef {{ kind: 'none' } | { kind: 'unsatisfiable' } | { kind: 'ok', start: number, end: number }} RangeResult
 *
 * @param {string | null} header
 * @param {number} size
 * @returns {RangeResult}
 */
function parseRange(header, size) {
	if (!header) return { kind: 'none' };

	const match = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return { kind: 'none' };

	const startStr = match[1];
	const endStr = match[2];

	let start;
	let end;

	if (startStr === '' && endStr !== '') {
		// Suffix range: last N bytes.
		const suffix = parseInt(endStr, 10);
		if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'none' };
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else if (startStr !== '' && endStr === '') {
		start = parseInt(startStr, 10);
		end = size - 1;
	} else if (startStr !== '' && endStr !== '') {
		start = parseInt(startStr, 10);
		end = parseInt(endStr, 10);
	} else {
		return { kind: 'none' };
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: 'none' };
	if (start > end) return { kind: 'none' };
	if (start >= size) return { kind: 'unsatisfiable' };
	if (end >= size) end = size - 1;

	return { kind: 'ok', start, end };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, request, locals }) {
	const siteId = locals.siteId;
	const path = params.path;

	if (!path) {
		error(400, 'Missing asset path');
	}

	// Variant request: {stem}/w{width}.webp
	const variantMatch = path.match(/^([a-f0-9]{64})\/w(\d+)\.webp$/);
	if (variantMatch) {
		const assetStem = variantMatch[1];
		const width = parseInt(variantMatch[2], 10);

		let originalId = null;
		for (const ext of ['.webp', '.gif', '.svg', '.png', '.jpg', '.jpeg']) {
			if (assetExists(siteId, `${assetStem}${ext}`)) {
				originalId = `${assetStem}${ext}`;
				break;
			}
		}

		if (!originalId) {
			error(404, 'Asset not found');
		}

		const vp = variantPath(siteId, originalId, width);
		if (!existsSync(vp)) {
			error(404, 'Variant not found');
		}

		const stream = createVariantReadStream(siteId, originalId, width);
		return new Response(toWebStream(stream), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=31536000, immutable',
				'Content-Disposition': `inline; filename="${shortFilename(assetStem, '.webp')}"`
			}
		});
	}

	// Original request: {hash}.{ext}
	const originalMatch = path.match(/^([a-f0-9]{64}\.\w+)$/);
	if (!originalMatch) {
		error(400, 'Invalid asset path');
	}

	const assetId = originalMatch[1];

	if (!assetExists(siteId, assetId)) {
		error(404, 'Asset not found');
	}

	const ext = extname(assetId);
	const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream';
	const size = await assetSize(siteId, assetId);

	/** @type {Record<string, string>} */
	const baseHeaders = {
		'Content-Type': mimeType,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Content-Disposition': `inline; filename="${shortFilename(assetId, ext)}"`
	};

	const isVideo = mimeType.startsWith('video/');

	if (isVideo) {
		baseHeaders['Accept-Ranges'] = 'bytes';

		const range = parseRange(request.headers.get('range'), size);

		if (range.kind === 'unsatisfiable') {
			return new Response(null, {
				status: 416,
				headers: {
					...baseHeaders,
					'Content-Range': `bytes */${size}`
				}
			});
		}

		if (range.kind === 'ok') {
			const length = range.end - range.start + 1;
			const stream = createAssetReadStream(siteId, assetId, {
				start: range.start,
				end: range.end
			});
			return new Response(toWebStream(stream), {
				status: 206,
				headers: {
					...baseHeaders,
					'Content-Length': String(length),
					'Content-Range': `bytes ${range.start}-${range.end}/${size}`
				}
			});
		}
	}

	const stream = createAssetReadStream(siteId, assetId);
	return new Response(toWebStream(stream), {
		headers: {
			...baseHeaders,
			'Content-Length': String(size)
		}
	});
}
