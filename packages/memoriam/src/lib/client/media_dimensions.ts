export interface MediaDimensions {
	width: number;
	height: number;
}

/**
 * Extract image dimensions using an `<img>` element.
 */
function getImageDimensions(blob: Blob): Promise<MediaDimensions> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const objectUrl = URL.createObjectURL(blob);

		img.onload = () => {
			URL.revokeObjectURL(objectUrl);
			resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
		};

		img.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Failed to load image'));
		};

		img.src = objectUrl;
	});
}

/**
 * Extract dimensions from an SVG by parsing the viewBox attribute.
 * Falls back to getImageDimensions if no viewBox is found.
 */
async function getSvgDimensions(blob: Blob): Promise<MediaDimensions> {
	try {
		const text = await blob.text();
		const match = text.match(/viewBox=["']([^"']+)["']/);
		if (match) {
			const parts = match[1].trim().split(/[\s,]+/);
			if (parts.length === 4) {
				const width = parseFloat(parts[2]);
				const height = parseFloat(parts[3]);
				if (width > 0 && height > 0) {
					return { width: Math.round(width), height: Math.round(height) };
				}
			}
		}
	} catch {
		// Fall through to img-based extraction
	}
	return getImageDimensions(blob);
}

/**
 * Extract video dimensions using a temporary `<video>` element.
 */
export function getVideoDimensions(blob: Blob): Promise<MediaDimensions> {
	return new Promise((resolve, reject) => {
		const video = document.createElement('video');
		video.preload = 'metadata';
		const objectUrl = URL.createObjectURL(blob);

		video.onloadedmetadata = () => {
			URL.revokeObjectURL(objectUrl);
			resolve({ width: video.videoWidth, height: video.videoHeight });
		};

		video.onerror = () => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Failed to load video metadata'));
		};

		video.src = objectUrl;
	});
}

/**
 * Extract dimensions from a media file (image or video).
 */
export function getMediaDimensions(file: File): Promise<MediaDimensions> {
	if (file.type.startsWith('video/')) return getVideoDimensions(file);
	if (file.type === 'image/svg+xml') return getSvgDimensions(file);
	return getImageDimensions(file);
}
