/// <reference lib="webworker" />
import { encode as encodeWebP } from '@jsquash/webp';

const WEBP_QUALITY = 80;

/**
 * Decode an image file to ImageData using the browser's built-in
 * decoding. Works for JPEG, PNG, WebP, GIF, BMP, etc.
 */
async function decodeToImageData(blob: Blob): Promise<ImageData> {
	const bitmap = await createImageBitmap(blob);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not get OffscreenCanvas 2d context');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function imageDataToPngBlob(imageData: ImageData): Promise<Blob> {
	const canvas = new OffscreenCanvas(imageData.width, imageData.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not get OffscreenCanvas 2d context');
	ctx.putImageData(imageData, 0, 0);
	return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Resize an image blob to a specific width using canvas, maintaining
 * aspect ratio.
 */
async function resizeBlobToWidth(blob: Blob, targetWidth: number): Promise<ImageData> {
	const bitmap = await createImageBitmap(blob);
	const scale = targetWidth / bitmap.width;
	const targetHeight = Math.round(bitmap.height * scale);
	const canvas = new OffscreenCanvas(targetWidth, targetHeight);
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		bitmap.close();
		throw new Error('Could not get OffscreenCanvas 2d context');
	}
	ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
	bitmap.close();
	return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

/**
 * Resize ImageData to fit within maxWidth, preserving aspect ratio.
 * Returns the original ImageData if it already fits.
 */
async function resizeToFit(imageData: ImageData, maxWidth: number): Promise<ImageData> {
	const { width } = imageData;
	if (width <= maxWidth) return imageData;

	const pngBlob = await imageDataToPngBlob(imageData);
	return resizeBlobToWidth(pngBlob, maxWidth);
}

async function resizeToWidth(imageData: ImageData, targetWidth: number): Promise<ImageData> {
	const pngBlob = await imageDataToPngBlob(imageData);
	return resizeBlobToWidth(pngBlob, targetWidth);
}

async function encodeToWebp(
	imageData: ImageData,
	quality: number = WEBP_QUALITY
): Promise<ArrayBuffer> {
	return encodeWebP(imageData, { quality });
}

function postStatus(status: string): void {
	self.postMessage({ type: 'status', status });
}

interface ProcessRequest {
	file: File;
	max_width: number;
	variant_widths: number[];
}

async function handleProcess(data: ProcessRequest): Promise<void> {
	const { file, max_width: maxWidth, variant_widths: variantWidths } = data;

	try {
		postStatus('Decoding…');
		let imageData = await decodeToImageData(file);

		if (imageData.width > maxWidth) {
			postStatus('Resizing original…');
			imageData = await resizeToFit(imageData, maxWidth);
		}

		const originalWidth = imageData.width;
		const originalHeight = imageData.height;

		postStatus('Encoding original as WebP…');
		const originalBuffer = await encodeToWebp(imageData);

		const applicableWidths = variantWidths.filter((w) => w < originalWidth);
		const variants: Array<{ width: number; buffer: ArrayBuffer }> = [];

		for (let i = 0; i < applicableWidths.length; i++) {
			const targetWidth = applicableWidths[i];
			postStatus(`Encoding variant ${i + 1}/${applicableWidths.length} (w${targetWidth})…`);

			const resized = await resizeToWidth(imageData, targetWidth);
			const buffer = await encodeToWebp(resized);
			variants.push({ width: targetWidth, buffer });
		}

		postStatus('Done');

		const transferables: ArrayBuffer[] = [originalBuffer, ...variants.map((v) => v.buffer)];

		self.postMessage(
			{
				type: 'result',
				original: { buffer: originalBuffer, width: originalWidth, height: originalHeight },
				variants: variants.map((v) => ({ width: v.width, buffer: v.buffer }))
			},
			{ transfer: transferables }
		);
	} catch (err) {
		self.postMessage({
			type: 'error',
			error: err instanceof Error ? err.message : 'Processing failed'
		});
	}
}

self.addEventListener('message', (e: MessageEvent) => {
	if (e.data?.type === 'process') {
		void handleProcess(e.data);
	}
});
