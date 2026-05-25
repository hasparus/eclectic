import { processAsset } from './process_asset.js';
import { MAX_IMAGE_WIDTH } from '$lib/config.js';
import { getVideoDimensions, getMediaDimensions } from './media_dimensions.js';

interface PendingAsset {
	hash: string;
	asset_id: string;
	original: { blob: Blob; width: number; height: number };
	variants: Array<{ width: number; blob: Blob }>;
	status: 'processing' | 'ready' | 'error';
	error: string | null;
}

export interface UploadedAsset {
	asset_id: string;
	width: number;
	height: number;
}

/**
 * Map of blob URL → PendingAsset. Populated when images are
 * pasted/dropped, consulted during the save flow to upload and
 * replace blob URLs.
 */
const pendingAssets = new Map<string, PendingAsset>();

/**
 * Compute SHA-256 hex hash of a Blob.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function hashBlob( blob: Blob) {
	const buffer = await blob.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Detect whether a GIF file is animated by counting Graphic Control Extension blocks.
 *
 * @param {File} file
 * @returns {Promise<boolean>}
 */
async function isAnimatedGif( file: File) {
	if (file.type !== 'image/gif') return false;
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let count = 0;
	for (let i = 0; i < bytes.length - 1; i++) {
		if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) {
			count++;
			if (count > 1) return true;
		}
	}
	return false;
}

/**
 * Determine the stored file extension for a given file.
 *
 * @param {File} file
 * @param {boolean} animated
 * @returns {string}
 */
function getStoredExtension( file: File, animated: boolean) {
	if (file.type === 'image/svg+xml') return 'svg';
	if (file.type === 'image/gif' && animated) return 'gif';
	// All other raster images get converted to WebP
	return 'webp';
}

/**
 * Check if a file is a video based on MIME type.
 *
 * @param {File} file
 * @returns {boolean}
 */
function isVideo( file: File) {
	return file.type.startsWith('video/');
}

/**
 * Get the stored file extension for a video file.
 *
 * @param {File} file
 * @returns {string}
 */
function getVideoExtension( file: File) {
	if (file.type === 'video/webm') return 'webm';
	return 'mp4';
}

/**
 * Start background processing for a pasted/dropped media file.
 * Call this from handle_media_paste. The blobUrl is used as the key
 * to look up the processing result during the save flow.
 *
 * @param {string} blobUrl - The blob: URL set as the image node's src
 * @param {File} file - The original source file
 */
export async function startProcessing(blobUrl: string, file: File): Promise<void> {
	const entry: PendingAsset = {
		hash: '',
		asset_id: '',
		original: { blob: file, width: 0, height: 0 },
		variants: [],
		status: 'processing',
		error: null
	};
	pendingAssets.set(blobUrl, entry);

	if (isVideo(file)) {
		try {
			const [hash, dims] = await Promise.all([
				hashBlob(file),
				getVideoDimensions(file)
			]);
			const ext = getVideoExtension(file);
			entry.hash = hash;
			entry.asset_id = `${hash}.${ext}`;
			entry.original = { blob: file, width: dims.width, height: dims.height };
			entry.variants = [];
			entry.status = 'ready';
		} catch (err) {
			entry.status = 'error';
			entry.error = err instanceof Error ? err.message : 'Video processing failed';
			console.error(`Video processing failed for ${blobUrl}:`, err);
		}
		return;
	}

	try {
		// Hash and type detection run concurrently with processing
		const is_svg = file.type === 'image/svg+xml';
		const animated = await isAnimatedGif(file);
		const ext = getStoredExtension(file, animated);
		const hash = await hashBlob(file);

		entry.hash = hash;
		entry.asset_id = `${hash}.${ext}`;

		if (is_svg || animated) {
			// Passthrough — no WASM processing
			const dims = await getMediaDimensions(file);
			entry.original = { blob: file, width: dims.width, height: dims.height };
			entry.variants = [];
		} else {
			// Static raster image — process via WASM worker
			const result = await processAsset(file);
			entry.original = result.original;
			entry.variants = result.variants;
		}

		entry.status = 'ready';
	} catch (err) {
		entry.status = 'error';
		entry.error = err instanceof Error ? err.message : 'Processing failed';
		console.error(`Asset processing failed for ${blobUrl}:`, err);
	}
}

/**
 * Check if there are any assets still being processed.
 *
 * @returns {boolean}
 */
export function hasPendingProcessing() {
	for (const entry of pendingAssets.values()) {
		if (entry.status === 'processing') return true;
	}
	return false;
}

/**
 * @callback ProcessingProgressCallback
 * @param {{ done: number, total: number }} progress
 */

/**
 * Wait until all pending assets have finished processing.
 *
 * @param {ProcessingProgressCallback} [onProgress] - optional progress callback
 * @returns {Promise<void>}
 */
export async function waitForProcessing( onProgress: ((progress: any) => void) | undefined) {
	while (hasPendingProcessing()) {
		if (onProgress) {
			let done = 0;
			let total = 0;
			for (const entry of pendingAssets.values()) {
				total++;
				if (entry.status !== 'processing') done++;
			}
			onProgress({ done, total });
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

/**
 * Upload a blob using XHR with progress tracking.
 *
 * @param {string} url
 * @param {Blob} blob
 * @param {Record<string, string>} headers
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<any>}
 */
function uploadBlob(
	url: string,
	blob: Blob,
	headers: Record<string, string>,
	onProgress?: (progress: number) => void
): Promise<any> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		if (onProgress) {
			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable) {
					onProgress(Math.round((e.loaded / e.total) * 100));
				}
			});
		}
		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve(JSON.parse(xhr.responseText));
			} else {
				let message = `Upload failed: ${xhr.status}`;
				try {
					const body = JSON.parse(xhr.responseText);
					if (body.message) message = body.message;
				} catch { /* ignore */ }
				reject(new Error(message));
			}
		});
		xhr.addEventListener('error', () => reject(new Error('Upload failed (network error)')));

		xhr.open('POST', url);
		for (const [key, value] of Object.entries(headers)) {
			xhr.setRequestHeader(key, value);
		}
		xhr.send(blob);
	});
}

/**
 * Upload a single asset (original + variants) to the server.
 * Returns the asset_id on success.
 *
 * @param {PendingAsset} entry
 * @returns {Promise<{ asset_id: string, width: number, height: number }>}
 */
async function uploadAsset( entry: PendingAsset) {
	const contentType = entry.asset_id.endsWith('.svg')
		? 'image/svg+xml'
		: entry.asset_id.endsWith('.gif')
			? 'image/gif'
			: entry.asset_id.endsWith('.mp4')
				? 'video/mp4'
				: entry.asset_id.endsWith('.webm')
					? 'video/webm'
					: 'image/webp';

	// Upload original
	const result = await uploadBlob('/api/assets', entry.original.blob, {
		'Content-Type': contentType,
		'X-Content-Hash': entry.hash,
		'X-Asset-Width': String(entry.original.width),
		'X-Asset-Height': String(entry.original.height)
	});

	// If deduplicated, skip variant uploads
	if (result.deduplicated) {
		return { asset_id: result.asset_id, width: entry.original.width, height: entry.original.height };
	}

	// Upload variants sequentially
	for (let i = 0; i < entry.variants.length; i++) {
		const variant = entry.variants[i];
		try {
			await uploadBlob(`/api/assets/${result.asset_id}/variants`, variant.blob, {
				'Content-Type': 'image/webp',
				'X-Variant-Width': String(variant.width)
			});
		} catch (err) {
			// Clean up the partially uploaded asset
			try {
				await fetch(`/api/assets/${result.asset_id}`, { method: 'DELETE' });
			} catch { /* best effort cleanup */ }
			throw new Error(`Variant upload failed (w${variant.width}): ${err instanceof Error ? err.message : err}`);
		}
	}

	return { asset_id: result.asset_id, width: entry.original.width, height: entry.original.height };
}

/**
 * @callback UploadProgressCallback
 * @param {{ phase: 'uploading', index: number, total: number }} progress
 */

/**
 * Upload pending assets that are referenced in the document.
 * Only uploads entries whose blob URL appears in the provided list.
 * Throws on the first failure (after cleaning up the failed asset).
 *
 * @param {string[]} blobUrls - blob URLs currently in the document's image nodes
 * @param {UploadProgressCallback} [onProgress] - optional progress callback
 * @returns {Promise<Map<string, { asset_id: string, width: number, height: number }>>}
 */
export async function uploadPending( blobUrls: string[], onProgress: ((progress: any) => void) | undefined) {
	/** @type {Map<string, { asset_id: string, width: number, height: number }>} */
	const mapping = new Map();
	const total = blobUrls.length;

	for (let i = 0; i < blobUrls.length; i++) {
		const blobUrl = blobUrls[i];
		const entry = pendingAssets.get(blobUrl);
		if (!entry) {
			throw new Error(`No pending asset found for ${blobUrl}`);
		}
		if (entry.status === 'error') {
			throw new Error(`Asset processing failed: ${entry.error}`);
		}
		if (entry.status !== 'ready') {
			throw new Error('Some assets are still processing');
		}

		if (onProgress) {
			onProgress({ phase: 'uploading', index: i + 1, total });
		}

		const result = await uploadAsset(entry);
		mapping.set(blobUrl, result);
	}

	return mapping;
}

/**
 * Replace blob URLs in document nodes with asset ids using the upload mapping.
 * Also updates width and height to the processed dimensions.
 *
 * @param {Record<string, any>} nodes - The document's nodes map (mutated in place)
 * @param {Map<string, { asset_id: string, width: number, height: number }>} mapping
 */
export function replaceBlobUrls( nodes: Record<string, any>, mapping: Map<string, { asset_id: string, width: number, height: number }>) {
	for (const node of Object.values(nodes)) {
		if ((node.type === 'image' || node.type === 'video') && typeof node.src === 'string' && node.src.startsWith('blob:')) {
			const entry = mapping.get(node.src);
			if (entry) {
				node.src = entry.asset_id;
				node.width = entry.width;
				node.height = entry.height;
			}
		}
	}
}

/**
 * Ensure all blob URLs have pending asset entries. For any blob URL
 * that's missing from the map (e.g. after undo brought back blob URLs
 * that were cleaned up after a previous save), re-fetch the blob and
 * restart processing.
 *
 * @param {string[]} blobUrls - blob URLs currently in the document's image nodes
 * @returns {Promise<void>}
 */
export async function ensureProcessing( blobUrls: string[]) {
	for (const blobUrl of blobUrls) {
		if (pendingAssets.has(blobUrl)) continue;

		// Re-fetch the blob from the still-valid blob URL
		try {
			const response = await fetch(blobUrl);
			const blob = await response.blob();
			const fallbackType = blob.type || 'image/png';
			const fallbackName = fallbackType.startsWith('video/') ? 'pasted-video' : 'pasted-image';
			const file = new File([blob], fallbackName, { type: fallbackType });
			startProcessing(blobUrl, file);
		} catch (err) {
			console.error(`Failed to re-process asset for ${blobUrl}:`, err);
			// Create a failed entry so uploadPending will report the error
			pendingAssets.set(blobUrl, {
				hash: '',
				asset_id: '',
				original: { blob: new Blob(), width: 0, height: 0 },
				variants: [],
				status: 'error',
				error: `Failed to re-fetch blob URL: ${err instanceof Error ? err.message : err}`
			});
		}
	}
}

/**
 * Collect all blob URLs from image nodes in a document.
 *
 * @param {Record<string, any>} nodes
 * @returns {string[]}
 */
export function collectBlobUrls( nodes: Record<string, any>) {
	const blobUrls = [];
	for (const node of Object.values(nodes)) {
		if ((node.type === 'image' || node.type === 'video') && typeof node.src === 'string' && node.src.startsWith('blob:')) {
			blobUrls.push(node.src);
		}
	}
	return blobUrls;
}

/**
 * Clean up completed entries from the pending map.
 * Call after a successful save.
 *
 * @param {Map<string, { asset_id: string, width: number, height: number }>} mapping
 */
export function cleanupPending( mapping: Map<string, { asset_id: string, width: number, height: number }>) {
	for (const blobUrl of mapping.keys()) {
		pendingAssets.delete(blobUrl);
	}
}