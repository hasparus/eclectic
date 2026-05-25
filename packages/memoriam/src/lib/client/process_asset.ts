import { MAX_IMAGE_WIDTH, VARIANT_WIDTHS } from '$lib/config.js';

export interface ProcessedAsset {
	original: { blob: Blob; width: number; height: number };
	variants: Array<{ width: number; blob: Blob }>;
}

export interface ProcessOptions {
	onStatus?: (status: string) => void;
}

interface WorkerMessage {
	type: 'status' | 'error' | 'result';
	status?: string;
	error?: string;
	original?: { buffer: ArrayBuffer; width: number; height: number };
	variants?: Array<{ width: number; buffer: ArrayBuffer }>;
}

/**
 * Process an image file off the main thread using a Web Worker.
 * Decodes, resizes, encodes to WebP, generates all configured size
 * variants.
 */
export function processAsset(file: File, options: ProcessOptions = {}): Promise<ProcessedAsset> {
	const { onStatus } = options;

	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./asset_processor.js', import.meta.url), {
			type: 'module'
		});

		worker.addEventListener('message', (e) => {
			const msg = e.data as WorkerMessage;

			if (msg.type === 'status') {
				onStatus?.(msg.status ?? '');
				return;
			}

			if (msg.type === 'error') {
				worker.terminate();
				reject(new Error(msg.error ?? 'Worker error'));
				return;
			}

			if (msg.type === 'result' && msg.original && msg.variants) {
				worker.terminate();

				const originalBlob = new Blob([msg.original.buffer], { type: 'image/webp' });
				const variants = msg.variants.map((v) => ({
					width: v.width,
					blob: new Blob([v.buffer], { type: 'image/webp' })
				}));

				resolve({
					original: {
						blob: originalBlob,
						width: msg.original.width,
						height: msg.original.height
					},
					variants
				});
			}
		});

		worker.addEventListener('error', (e) => {
			worker.terminate();
			reject(new Error(e.message || 'Worker error'));
		});

		worker.postMessage({
			type: 'process',
			file,
			max_width: MAX_IMAGE_WIDTH,
			variant_widths: VARIANT_WIDTHS
		});
	});
}
