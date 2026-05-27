import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

/**
 * Engraving presets. The `qrMm` is the QR code's edge length on the
 * finished medium; the surrounding paper carries the human-readable
 * URL fallback and a small label. Each preset trades physical size
 * for scannability margin:
 *
 *   - `card`: 25 mm — wallet cards, memorial mementos. Scan distance
 *     ≤ 30 cm; needs a clean print surface (paper, plastic).
 *   - `plaque`: 50 mm — bronze plaques, urn inlays. Scan distance
 *     ≤ 60 cm; tolerates moderate weathering.
 *   - `headstone`: 80 mm — granite or stone markers outdoors.
 *     Generous size, EC-H redundancy, and a printed URL fallback
 *     are all that protect against lichen, etching, and rain.
 *
 * Adding a preset? Keep `qrMm` in the [25, 100] range; below 25 mm
 * the module size falls under the readable threshold for most phone
 * cameras at arm's length.
 */
export const QR_PDF_PRESETS = {
	card: { qrMm: 25, label: 'Memorial card (25 mm)' },
	plaque: { qrMm: 50, label: 'Plaque (50 mm)' },
	headstone: { qrMm: 80, label: 'Headstone (80 mm)' }
} as const;

export type QrPdfSize = keyof typeof QR_PDF_PRESETS;

export interface GenerateQrPdfOptions {
	/** SVG output from `generateQrSvg` (or any square SVG with a `0 0 N N` viewBox). */
	qrSvg: string;
	/** Human-readable URL printed beneath the QR — the engraving's "if scan fails, type this" fallback. */
	url: string;
	/** Preset size. Default `plaque`. */
	size?: QrPdfSize;
	/** Optional title printed above the QR (memorial display name). */
	title?: string;
}

// 1 mm = 72 / 25.4 ≈ 2.83465 PDF points.
const MM_TO_PT = 72 / 25.4;
const mm = (x: number) => x * MM_TO_PT;

/**
 * Render a print-ready PDF carrying the QR at a fixed physical size
 * with the URL printed below as a human-readable fallback (per RTL
 * accessibility convention: every QR should be usable without one).
 *
 * The QR itself is embedded as vector via `svg-to-pdfkit`, so the
 * output stays sharp at any zoom. PDFKit's built-in Helvetica covers
 * the URL/title text — no font embedding, smaller file.
 */
export function generateQrPdf(options: GenerateQrPdfOptions): Promise<Buffer> {
	const preset = QR_PDF_PRESETS[options.size ?? 'plaque'];
	// Page dimensions: square paper sized to the QR plus margins big
	// enough for the title + URL caption. Keeps the print boundary
	// obvious to the engraver.
	const marginMm = 10;
	const labelMm = options.title ? 10 : 0;
	const captionMm = 8;
	const paperW = preset.qrMm + marginMm * 2;
	const paperH = preset.qrMm + marginMm * 2 + labelMm + captionMm;

	const doc = new PDFDocument({
		size: [mm(paperW), mm(paperH)],
		margin: 0,
		// `info` shows in the PDF reader's properties pane. Useful for
		// support when an engraver opens a file weeks after download.
		info: {
			Title: options.title ? `${options.title} — QR` : 'Memoriam QR',
			Producer: 'Memoriam',
			Creator: 'Memoriam'
		}
	});

	const chunks: Buffer[] = [];
	doc.on('data', (chunk) => chunks.push(chunk));

	let cursorY = mm(marginMm);

	if (options.title) {
		doc
			.font('Helvetica-Bold')
			.fontSize(11)
			.fillColor('#000')
			.text(options.title, 0, cursorY, {
				width: mm(paperW),
				align: 'center'
			});
		cursorY += mm(labelMm);
	}

	const qrSize = mm(preset.qrMm);
	const qrX = (mm(paperW) - qrSize) / 2;
	// svg-to-pdfkit honours `width`/`height` and preserves the SVG's
	// vector primitives in the PDF stream.
	SVGtoPDF(doc, options.qrSvg, qrX, cursorY, {
		width: qrSize,
		height: qrSize,
		preserveAspectRatio: 'xMidYMid meet',
		assumePt: false
	});
	cursorY += qrSize + mm(2);

	doc
		.font('Helvetica')
		.fontSize(9)
		.fillColor('#000')
		.text(options.url, 0, cursorY, {
			width: mm(paperW),
			align: 'center'
		});

	doc.end();
	return new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
}
