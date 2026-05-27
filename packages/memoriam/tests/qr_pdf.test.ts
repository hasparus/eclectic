import { describe, it, expect } from 'vitest';
import { generateQrSvg } from '../src/lib/server/qr.js';
import { generateQrPdf, QR_PDF_PRESETS } from '../src/lib/server/qr_pdf.js';

async function qr() {
	return generateQrSvg('https://memoriam.app/r/abc123');
}

describe('generateQrPdf', () => {
	it('emits a valid PDF that starts with the magic header', async () => {
		const pdf = await generateQrPdf({
			qrSvg: await qr(),
			url: 'https://memoriam.app/r/abc123'
		});
		expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
	});

	it('uses page dimensions matching the preset edge length', async () => {
		// PDFs declare paper size in points (72 pt = 1 inch = 25.4 mm)
		// in a `/MediaBox [0 0 width height]` entry inside each /Page
		// object. The plaque preset adds 10 mm margins each side around
		// a 50 mm QR plus a small caption strip — width should be
		// (50 + 20) mm = 70 mm = 198.42 pt.
		const pdf = await generateQrPdf({
			qrSvg: await qr(),
			url: 'https://memoriam.app/r/abc123',
			size: 'plaque'
		});
		const expected = (50 + 20) * (72 / 25.4);
		const mediaBox = pdf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
		expect(mediaBox).toBeTruthy();
		expect(Number(mediaBox![1])).toBeCloseTo(expected, 1);
	});

	it('grows the output when a title is rendered above the QR', async () => {
		// PDFKit emits text as hex glyph codes split by kerning, so
		// checking for plain-text needles in the bytes is unreliable.
		// What we can verify is that adding the title produces a
		// larger PDF than the same render without it — the title
		// must be in there somewhere.
		const url = 'https://memoriam.app/r/abc123';
		const without = await generateQrPdf({ qrSvg: await qr(), url });
		const withTitle = await generateQrPdf({
			qrSvg: await qr(),
			url,
			title: 'A long memorial title with several words'
		});
		expect(withTitle.length).toBeGreaterThan(without.length);
	});

	it('supports every preset size', async () => {
		for (const size of Object.keys(QR_PDF_PRESETS) as Array<keyof typeof QR_PDF_PRESETS>) {
			const pdf = await generateQrPdf({
				qrSvg: await qr(),
				url: 'https://memoriam.app/r/abc123',
				size
			});
			expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
		}
	});
});
