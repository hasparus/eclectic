import { describe, it, expect } from 'vitest';
import { generateQrSvg } from '../src/lib/server/qr.js';

const sampleLogo = `<svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
	<circle cx="36" cy="36" r="30" fill="currentColor"/>
</svg>`;

describe('generateQrSvg', () => {
	it('returns a square SVG with two paths (background + modules)', async () => {
		const svg = await generateQrSvg('https://example.com');
		expect(svg).toMatch(/^<svg /);
		expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);
		// qrcode emits two `<path>` elements: one filled rect for the
		// background and one stroked path for the dark modules. Single
		// path per area keeps print PDFs tiny and avoids hairline seams.
		expect((svg.match(/<path /g) ?? []).length).toBe(2);
	});

	it('encodes the input data', async () => {
		// Two distinct URLs should yield distinct SVGs.
		const a = await generateQrSvg('https://memoriam.app/r/aaaa');
		const b = await generateQrSvg('https://memoriam.app/r/bbbb');
		expect(a).not.toBe(b);
	});

	it('embeds the logo inside a nested <svg> at the centre', async () => {
		const svg = await generateQrSvg('https://example.com', { logo: { svg: sampleLogo } });
		// Original QR <path> still present.
		expect(svg).toMatch(/<path /);
		// Logo is nested via a child <svg> with x/y/width/height set.
		expect(svg).toMatch(/<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 72 72">/);
		// And it carries the logo's <circle> content forward.
		expect(svg).toContain('<circle');
		// Backdrop rect is drawn first so modules don't bleed through.
		expect(svg).toMatch(/<rect [^/]*fill="#ffffff"\/>/);
	});

	it('clamps the logo scale to a safe range', async () => {
		// scale=0.9 should be clamped to 0.25; the resulting box size
		// must be <= 25% of the QR's viewBox width.
		const svg = await generateQrSvg('https://example.com', {
			logo: { svg: sampleLogo, scale: 0.9 }
		});
		const qrViewBox = svg.match(/^<svg [^>]*viewBox="0 0 (\d+) \1"/);
		const inner = svg.match(/<svg x="[\d.]+" y="[\d.]+" width="([\d.]+)" /);
		expect(qrViewBox).toBeTruthy();
		expect(inner).toBeTruthy();
		const total = Number(qrViewBox![1]);
		const box = Number(inner![1]);
		expect(box / total).toBeLessThanOrEqual(0.25);
		expect(box / total).toBeGreaterThan(0);
	});

	it('honours backgroundFill: null by omitting the backdrop rect', async () => {
		const withBackdrop = await generateQrSvg('https://example.com', {
			logo: { svg: sampleLogo }
		});
		const noBackdrop = await generateQrSvg('https://example.com', {
			logo: { svg: sampleLogo, backgroundFill: null }
		});
		// qrcode itself emits no `<rect>` (the background is a `<path>`),
		// so any rect we see is our logo backdrop.
		expect((withBackdrop.match(/<rect /g) ?? []).length).toBe(1);
		expect((noBackdrop.match(/<rect /g) ?? []).length).toBe(0);
	});

	it('uses error-correction level H by default', async () => {
		// EC-H reserves more bytes for redundancy than EC-L, so for the
		// same payload it needs a bigger matrix. Use a payload long
		// enough to cross a version boundary between L and H.
		const payload = 'https://memoriam.app/r/' + 'x'.repeat(40);
		const high = await generateQrSvg(payload);
		const low = await generateQrSvg(payload, { errorCorrectionLevel: 'L' });
		const sizeOf = (svg: string) => Number(svg.match(/viewBox="0 0 (\d+) \1"/)![1]);
		expect(sizeOf(high)).toBeGreaterThan(sizeOf(low));
	});
});
