import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';

/**
 * Svelte action: attach d3-zoom to an `<svg>`, applying the resulting
 * transform to its first `<g>` child (which the caller is responsible
 * for rendering as the content root).
 *
 * - Mouse wheel / pinch-trackpad zoom
 * - Click-drag to pan
 * - Touch pan + pinch on mobile
 *
 * `scaleExtent` is conservative — humans get lost fast when a tree
 * shrinks past 0.2x or grows past 3x. The action takes no params so
 * the consumer can drop it on any SVG with `use:treeZoom`.
 */
export function treeZoom(svg: SVGSVGElement) {
	const sel = select<SVGSVGElement, unknown>(svg);
	const inner = svg.querySelector<SVGGElement>('g.zoomable');
	if (!inner) {
		// No zoomable layer present — the consumer hasn't structured the
		// SVG with a top-level `<g class="zoomable">`. Be a no-op rather
		// than throw, so the canvas still renders without pan/zoom.
		return { destroy() {} };
	}
	const innerSel = select(inner);

	const behavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
		.scaleExtent([0.2, 3])
		.on('zoom', (event) => {
			innerSel.attr('transform', event.transform.toString());
		});

	sel.call(behavior);

	// Reset transform at start so a fresh mount lands at identity (not
	// whatever a prior session left).
	sel.call(behavior.transform, zoomIdentity);

	return {
		destroy() {
			sel.on('.zoom', null);
		}
	};
}
