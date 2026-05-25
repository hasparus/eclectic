import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import {
	asset_exists,
	asset_size,
	create_asset_read_stream,
	create_variant_read_stream,
	variant_path
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
 * @param {import('node:stream').Readable} node_stream
 * @returns {ReadableStream<Uint8Array>}
 */
function to_web_stream(node_stream) {
	return /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(node_stream));
}

/**
 * Extract the first 8 hex characters from an asset id for Content-Disposition filename.
 * @param {string} asset_id
 * @param {string} ext
 * @returns {string}
 */
function short_filename(asset_id, ext) {
	return `${asset_id.slice(0, 8)}${ext}`;
}

/**
 * Parse an HTTP Range header for a single byte range. Returns null when
 * the header is absent, malformed, or specifies multiple ranges (which we
 * do not support). Returns null with `unsatisfiable: true` when the range
 * is outside the file. Otherwise returns the resolved byte range.
 *
 * @param {string | null} header
 * @param {number} size
 * @returns {{ start: number, end: number } | null | { unsatisfiable: true }}
 */
function parse_range(header, size) {
	if (!header) return null;

	const match = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;

	const start_str = match[1];
	const end_str = match[2];

	let start;
	let end;

	if (start_str === '' && end_str !== '') {
		// Suffix range: last N bytes.
		const suffix = parseInt(end_str, 10);
		if (!Number.isFinite(suffix) || suffix <= 0) return null;
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else if (start_str !== '' && end_str === '') {
		start = parseInt(start_str, 10);
		end = size - 1;
	} else if (start_str !== '' && end_str !== '') {
		start = parseInt(start_str, 10);
		end = parseInt(end_str, 10);
	} else {
		return null;
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start > end) return null;
	if (start >= size) return { unsatisfiable: true };
	if (end >= size) end = size - 1;

	return { start, end };
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, request, locals }) {
	const site_id = locals.site_id;
	const path = params.path;

	if (!path) {
		error(400, 'Missing asset path');
	}

	// Variant request: {stem}/w{width}.webp
	const variant_match = path.match(/^([a-f0-9]{64})\/w(\d+)\.webp$/);
	if (variant_match) {
		const asset_stem = variant_match[1];
		const width = parseInt(variant_match[2], 10);

		let original_id = null;
		for (const ext of ['.webp', '.gif', '.svg', '.png', '.jpg', '.jpeg']) {
			if (asset_exists(site_id, `${asset_stem}${ext}`)) {
				original_id = `${asset_stem}${ext}`;
				break;
			}
		}

		if (!original_id) {
			error(404, 'Asset not found');
		}

		const vp = variant_path(site_id, original_id, width);
		if (!existsSync(vp)) {
			error(404, 'Variant not found');
		}

		const stream = create_variant_read_stream(site_id, original_id, width);
		return new Response(to_web_stream(stream), {
			headers: {
				'Content-Type': 'image/webp',
				'Cache-Control': 'public, max-age=31536000, immutable',
				'Content-Disposition': `inline; filename="${short_filename(asset_stem, '.webp')}"`
			}
		});
	}

	// Original request: {hash}.{ext}
	const original_match = path.match(/^([a-f0-9]{64}\.\w+)$/);
	if (!original_match) {
		error(400, 'Invalid asset path');
	}

	const asset_id = original_match[1];

	if (!asset_exists(site_id, asset_id)) {
		error(404, 'Asset not found');
	}

	const ext = extname(asset_id);
	const mime_type = EXT_TO_MIME[ext] || 'application/octet-stream';
	const size = await asset_size(site_id, asset_id);

	/** @type {Record<string, string>} */
	const base_headers = {
		'Content-Type': mime_type,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Content-Disposition': `inline; filename="${short_filename(asset_id, ext)}"`
	};

	const is_video = mime_type.startsWith('video/');

	if (is_video) {
		base_headers['Accept-Ranges'] = 'bytes';

		const range = parse_range(request.headers.get('range'), size);

		if (range && 'unsatisfiable' in range) {
			return new Response(null, {
				status: 416,
				headers: {
					...base_headers,
					'Content-Range': `bytes */${size}`
				}
			});
		}

		if (range) {
			const length = range.end - range.start + 1;
			const stream = create_asset_read_stream(site_id, asset_id, {
				start: range.start,
				end: range.end
			});
			return new Response(to_web_stream(stream), {
				status: 206,
				headers: {
					...base_headers,
					'Content-Length': String(length),
					'Content-Range': `bytes ${range.start}-${range.end}/${size}`
				}
			});
		}
	}

	const stream = create_asset_read_stream(site_id, asset_id);
	return new Response(to_web_stream(stream), {
		headers: {
			...base_headers,
			'Content-Length': String(size)
		}
	});
}
