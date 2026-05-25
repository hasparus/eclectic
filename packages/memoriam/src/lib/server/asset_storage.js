import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, unlink, rm, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { site_asset_path } from '$lib/server_config.js';

/**
 * @param {string} site_id
 * @returns {string}
 */
function ensure_site_asset_dir(site_id) {
	const dir = site_asset_path(site_id);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Get the full filesystem path for an original asset.
 *
 * @param {string} site_id
 * @param {string} asset_id - e.g. "c4b519da...fabdb.webp"
 * @returns {string}
 */
export function asset_path(site_id, asset_id) {
	return join(site_asset_path(site_id), asset_id);
}

/**
 * Get the stem (asset id without extension) for building variant paths.
 *
 * @param {string} asset_id
 * @returns {string}
 */
function stem(asset_id) {
	const ext = extname(asset_id);
	return ext ? asset_id.slice(0, -ext.length) : asset_id;
}

/**
 * Get the directory path for an asset's variants.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @returns {string}
 */
export function variant_dir(site_id, asset_id) {
	return join(site_asset_path(site_id), stem(asset_id));
}

/**
 * Get the full filesystem path for a width variant.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @param {number} width
 * @returns {string}
 */
export function variant_path(site_id, asset_id, width) {
	return join(variant_dir(site_id, asset_id), `w${width}.webp`);
}

/**
 * Stream a ReadableStream (web), Buffer, or Uint8Array to a file on disk.
 * Returns the number of bytes written and the SHA-256 hex digest of the
 * bytes that were written, so callers can verify uploads match a claimed
 * hash.
 *
 * @param {string} file_path
 * @param {ReadableStream | Buffer | Uint8Array} data
 * @returns {Promise<{ bytes_written: number, sha256_hex: string }>}
 */
async function stream_to_file(file_path, data) {
	/** @type {import('node:stream').Readable} */
	let source;

	if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
		source = Readable.from([data]);
	} else {
		source = Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (data));
	}

	let bytes_written = 0;
	const hasher = createHash('sha256');

	const counter = new Transform({
		transform(chunk, _encoding, callback) {
			bytes_written += chunk.length;
			hasher.update(chunk);
			callback(null, chunk);
		}
	});

	const dest = createWriteStream(file_path);
	await pipeline(source, counter, dest);

	return { bytes_written, sha256_hex: hasher.digest('hex') };
}

/**
 * Write an original asset to disk, streaming.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @param {ReadableStream | Buffer | Uint8Array} data
 * @returns {Promise<{ bytes_written: number, sha256_hex: string }>}
 */
export async function write_asset(site_id, asset_id, data) {
	ensure_site_asset_dir(site_id);
	return stream_to_file(asset_path(site_id, asset_id), data);
}

/**
 * Write a width variant to disk, streaming.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @param {number} width
 * @param {ReadableStream | Buffer | Uint8Array} data
 * @returns {Promise<{ bytes_written: number, sha256_hex: string }>}
 */
export async function write_variant(site_id, asset_id, width, data) {
	const dir = variant_dir(site_id, asset_id);
	await mkdir(dir, { recursive: true });
	return stream_to_file(variant_path(site_id, asset_id, width), data);
}

/**
 * Check if an original asset exists on disk.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @returns {boolean}
 */
export function asset_exists(site_id, asset_id) {
	return existsSync(asset_path(site_id, asset_id));
}

/**
 * Delete an asset and all its variants from disk.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @returns {Promise<void>}
 */
export async function delete_asset(site_id, asset_id) {
	try {
		await unlink(asset_path(site_id, asset_id));
	} catch {
		// File may not exist
	}

	const dir = variant_dir(site_id, asset_id);
	if (existsSync(dir)) {
		await rm(dir, { recursive: true });
	}
}

/**
 * Create a Node.js ReadStream for an original asset, optionally limited
 * to a byte range (for HTTP Range requests on videos).
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @param {{ start?: number, end?: number }} [range]
 * @returns {import('node:fs').ReadStream}
 */
export function create_asset_read_stream(site_id, asset_id, range) {
	return createReadStream(asset_path(site_id, asset_id), range);
}

/**
 * Create a Node.js ReadStream for a width variant.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @param {number} width
 * @returns {import('node:fs').ReadStream}
 */
export function create_variant_read_stream(site_id, asset_id, width) {
	return createReadStream(variant_path(site_id, asset_id, width));
}

/**
 * Get the size of an original asset in bytes.
 *
 * @param {string} site_id
 * @param {string} asset_id
 * @returns {Promise<number>}
 */
export async function asset_size(site_id, asset_id) {
	const s = await stat(asset_path(site_id, asset_id));
	return s.size;
}
