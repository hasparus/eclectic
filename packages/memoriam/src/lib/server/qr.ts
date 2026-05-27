import QRCode from 'qrcode';

export interface QrLogoOptions {
	/**
	 * Inner SVG markup to draw at the centre of the QR code. The QR is
	 * always rendered with error-correction level H, so up to ~30% of
	 * modules may be obscured before the code becomes unreadable — we
	 * cap the logo box at 20% of the QR size to stay safely inside that
	 * budget.
	 *
	 * The logo SVG must use a viewBox; we drop it into a nested `<svg>`
	 * so the original `width`/`height` attributes are irrelevant. The
	 * caller is responsible for ensuring the logo isn't user-controlled
	 * SVG (no script tags etc.) — in this project the logo comes from
	 * the bundled static asset, not from user input.
	 */
	svg: string;
	/**
	 * Fraction of the QR's edge length the logo box should occupy.
	 * Default 0.2; clamped to [0.05, 0.25].
	 */
	scale?: number;
	/**
	 * Background fill behind the logo. Defaults to the QR's light
	 * colour (white) so the logo cut-out reads cleanly. Pass null to
	 * skip the backdrop and overlay the logo directly on the modules.
	 */
	backgroundFill?: string | null;
}

export interface GenerateQrSvgOptions {
	/** L | M | Q | H. Defaults to 'H' (~30% redundancy) to leave room for a logo. */
	errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
	/** Quiet-zone modules around the QR. Default 1. */
	margin?: number;
	/** Module ("dark") colour. Default '#000000'. */
	dark?: string;
	/** Background ("light") colour. Default '#ffffff'. */
	light?: string;
	logo?: QrLogoOptions;
}

const QR_VIEWBOX_REGEX = /viewBox="0 0 (\d+) \1"/;

/**
 * Generate a QR code as an SVG string, optionally compositing a logo
 * into the centre.
 *
 * `qrcode` emits one optimised `<path>` per QR, which keeps print PDFs
 * tiny and avoids hairline seams between modules. We parse out its
 * viewBox so we know what coordinate system to drop the logo into.
 */
export async function generateQrSvg(
	data: string,
	options: GenerateQrSvgOptions = {}
): Promise<string> {
	const svg = await QRCode.toString(data, {
		type: 'svg',
		errorCorrectionLevel: options.errorCorrectionLevel ?? 'H',
		margin: options.margin ?? 1,
		color: {
			dark: options.dark ?? '#000000',
			light: options.light ?? '#ffffff'
		}
	});

	if (!options.logo) return svg;

	const match = svg.match(QR_VIEWBOX_REGEX);
	if (!match) {
		// qrcode always emits a square viewBox; if the format ever
		// changes, fail loudly rather than silently drop the logo.
		throw new Error('Unexpected QR SVG format: no square viewBox');
	}
	const size = Number(match[1]);
	const margin = options.margin ?? 1;
	// One module = one viewBox unit. The matrix is always an odd
	// square (21, 25, 29, …); together with the symmetric quiet zone
	// the full viewBox edge is also odd.
	const matrixSize = size - 2 * margin;
	const rawScale = options.logo.scale ?? 0.2;
	const scale = Math.max(0.05, Math.min(0.25, rawScale));

	// Snap the backdrop to an *odd* module count so it centres on the
	// matrix's middle module — both halves come out as integers, giving
	// pixel-perfect alignment with the QR's module grid (no half-module
	// seams between the white box and the surrounding dark modules).
	const target = matrixSize * scale;
	const backdropModules = Math.max(3, nearestOdd(target));
	const offset = (size - backdropModules) / 2;

	const backdrop =
		options.logo.backgroundFill === null
			? ''
			: `<rect x="${offset}" y="${offset}" width="${backdropModules}" height="${backdropModules}" fill="${options.logo.backgroundFill ?? options.light ?? '#ffffff'}"/>`;
	const inner = stripOuterSvg(options.logo.svg);
	const overlay = `<g>${backdrop}<svg x="${offset}" y="${offset}" width="${backdropModules}" height="${backdropModules}" viewBox="${inner.viewBox}">${inner.body}</svg></g>`;

	return svg.replace('</svg>', `${overlay}</svg>`);
}

/** Round to the nearest odd integer; ties go to the lower odd. */
function nearestOdd(x: number): number {
	const lower = Math.floor(x);
	const oddLower = lower % 2 === 1 ? lower : lower - 1;
	const oddUpper = oddLower + 2;
	return x - oddLower <= oddUpper - x ? oddLower : oddUpper;
}

interface StrippedSvg {
	viewBox: string;
	body: string;
}

/**
 * Extract the inner body and viewBox of an `<svg>` element so it can
 * be re-emitted inside a nested `<svg x=... y=... width=... height=...>`
 * without dragging along stale `class`, `width`, or `xmlns` attributes
 * that would conflict with the host document.
 */
function stripOuterSvg(svg: string): StrippedSvg {
	const openTag = svg.match(/<svg\b[^>]*>/);
	if (!openTag) throw new Error('Logo SVG has no <svg> tag');
	const viewBoxMatch = openTag[0].match(/viewBox="([^"]+)"/);
	if (!viewBoxMatch) throw new Error('Logo SVG is missing a viewBox attribute');
	const body = svg
		.slice(openTag.index! + openTag[0].length)
		.replace(/<\/svg>\s*$/, '')
		.trim();
	return { viewBox: viewBoxMatch[1], body };
}
