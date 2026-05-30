import { graphStratify, sugiyama, decrossTwoLayer, coordCenter } from 'd3-dag';
import type { Person, ParentEdge, Couple, TreePayload } from '$lib/people_types.js';

export interface LaidOutNode {
	id: string;
	x: number;
	y: number;
	person: Person;
}

export interface LaidOutEdge {
	from: string;
	to: string;
	from_xy: [number, number];
	to_xy: [number, number];
	kind: string;
}

export interface LaidOutCouple {
	couple_id: string;
	a: string;
	b: string;
	a_xy: [number, number];
	b_xy: [number, number];
}

export interface Layout {
	nodes: LaidOutNode[];
	edges: LaidOutEdge[];
	couples: LaidOutCouple[];
	width: number;
	height: number;
}

export const CARD_WIDTH = 170;
export const CARD_HEIGHT = 64;
const NODE_GAP_X = 32;
const NODE_GAP_Y = 56;

/**
 * Lay out a parent-child DAG using d3-dag's Sugiyama. Couples are not
 * fed to the layout — they're decorations rendered as a thin line
 * between the two adjacent spouse cards, computed after the fact from
 * the laid-out positions.
 *
 * Returns coordinates in a left-to-right, top-to-bottom space where
 * the SVG viewBox matches { 0, 0, width, height }.
 */
export function layoutTree(tree: TreePayload): Layout {
	if (tree.people.length === 0) {
		return { nodes: [], edges: [], couples: [], width: 0, height: 0 };
	}

	// Build the input expected by graphStratify: each node knows its
	// parent ids. d3-dag rejects unknown parents, so if an edge points
	// to/from a person not in `tree.people` (clipped at the depth
	// boundary) we drop it.
	const personById = new Map<string, Person>(tree.people.map((p) => [p.person_id, p]));
	const parentsOf = new Map<string, string[]>();
	for (const p of tree.people) parentsOf.set(p.person_id, []);
	const usedEdges: ParentEdge[] = [];
	for (const e of tree.parent_edges) {
		if (!personById.has(e.parent_id) || !personById.has(e.child_id)) continue;
		parentsOf.get(e.child_id)!.push(e.parent_id);
		usedEdges.push(e);
	}

	interface StratifyDatum {
		id: string;
		parentIds: string[];
	}
	const input: StratifyDatum[] = tree.people.map((p) => ({
		id: p.person_id,
		parentIds: parentsOf.get(p.person_id) ?? []
	}));

	const builder = graphStratify()
		.id((d: StratifyDatum) => d.id)
		.parentIds((d: StratifyDatum) => d.parentIds);
	const graph = builder(input);

	const layout = sugiyama()
		.decross(decrossTwoLayer())
		.coord(coordCenter())
		.nodeSize([CARD_WIDTH + NODE_GAP_X, CARD_HEIGHT + NODE_GAP_Y]);

	const { width, height } = layout(graph);

	const xyById = new Map<string, [number, number]>();
	const nodes: LaidOutNode[] = [];
	for (const node of graph.nodes()) {
		const person = personById.get(node.data.id)!;
		xyById.set(node.data.id, [node.x, node.y]);
		nodes.push({ id: node.data.id, x: node.x, y: node.y, person });
	}

	const edges: LaidOutEdge[] = usedEdges.map((e) => ({
		from: e.parent_id,
		to: e.child_id,
		from_xy: xyById.get(e.parent_id)!,
		to_xy: xyById.get(e.child_id)!,
		kind: e.kind
	}));

	const couples: LaidOutCouple[] = tree.couples
		.filter((c) => xyById.has(c.person_a_id) && xyById.has(c.person_b_id))
		.map((c) => ({
			couple_id: c.couple_id,
			a: c.person_a_id,
			b: c.person_b_id,
			a_xy: xyById.get(c.person_a_id)!,
			b_xy: xyById.get(c.person_b_id)!
		}));

	return { nodes, edges, couples, width, height };
}

/**
 * Format birth/death years for the card subtitle. "1925 — 2018" if
 * both known; "b. 1925" / "d. 2018" if only one; null otherwise.
 */
export function formatLifespan(p: Person): string | null {
	if (p.birth_year && p.death_year) return `${p.birth_year} — ${p.death_year}`;
	if (p.birth_year) return `b. ${p.birth_year}`;
	if (p.death_year) return `d. ${p.death_year}`;
	return null;
}

export type { Couple, ParentEdge };

// ---------------------------------------------------------------
// Fan-chart layout — Sosa-Stradonitz half-circle ancestor wheel.
// Used on small viewports where the horizontal Sugiyama canvas
// runs out of width. Only renders ancestors of the focal person.
// ---------------------------------------------------------------

export interface FanWedge {
	person: Person;
	/** Generation depth: 0 for focal, 1 for parents, 2 for grandparents… */
	generation: number;
	/** Inner radius of the wedge, in viewBox units. */
	inner_r: number;
	outer_r: number;
	/** Start / end angles in radians, measured clockwise from the
	 *  top (12 o'clock). A half-circle fan covers [-π/2, π/2]. */
	start_angle: number;
	end_angle: number;
}

export interface FanLayout {
	wedges: FanWedge[];
	center: { x: number; y: number };
	size: number;
}

/**
 * Lay out the ancestor tree of `focalId` as a half-circle fan
 * chart. Each generation occupies its own ring; each wedge is
 * located by Sosa-Stradonitz numbering (focal = 1, father = 2,
 * mother = 3, paternal grandfather = 4 …). Missing ancestors get
 * no wedge — the gap stays visible.
 *
 * "Father" vs "mother" is decided by `sex` if known (M → even
 * Sosa, F → odd), else the parent_edges' insertion order. The
 * convention only affects which side of the fan each parent
 * lands on; the data is the same.
 */
export function fanLayoutTree(
	tree: TreePayload,
	focalId: string,
	generations = 4
): FanLayout {
	const size = 640;
	const center = { x: size / 2, y: size - 32 };

	const personById = new Map(tree.people.map((p) => [p.person_id, p]));
	const focal = personById.get(focalId);
	if (!focal) return { wedges: [], center, size };

	// child → [parentA, parentB] ordered so the father (M) is first.
	// Falls back to insertion order when sex is unknown.
	const parentsByChild = new Map<string, string[]>();
	for (const e of tree.parent_edges) {
		const arr = parentsByChild.get(e.child_id) ?? [];
		arr.push(e.parent_id);
		parentsByChild.set(e.child_id, arr);
	}
	for (const [child, parents] of parentsByChild) {
		parents.sort((a, b) => {
			const sa = personById.get(a)?.sex;
			const sb = personById.get(b)?.sex;
			if (sa === sb) return 0;
			if (sa === 'M') return -1;
			if (sb === 'M') return 1;
			if (sa === 'F') return 1;
			if (sb === 'F') return -1;
			return 0;
		});
		parentsByChild.set(child, parents);
	}

	const wedges: FanWedge[] = [];
	const ringWidth = (size / 2 - 40) / (generations + 1);

	// Center wedge: focal person, half-disk.
	wedges.push({
		person: focal,
		generation: 0,
		inner_r: 0,
		outer_r: ringWidth,
		start_angle: -Math.PI / 2,
		end_angle: Math.PI / 2
	});

	// sosa → person id. Sosa 1 = focal.
	const sosaToPersonId = new Map<number, string>();
	sosaToPersonId.set(1, focalId);

	const TOTAL_ARC = Math.PI; // half circle
	const ARC_START = -Math.PI / 2;

	for (let gen = 1; gen <= generations; gen++) {
		const sosaStart = 2 ** gen;
		const sosaEnd = 2 ** (gen + 1) - 1;
		const wedgeCount = sosaEnd - sosaStart + 1;
		const wedgeArc = TOTAL_ARC / wedgeCount;

		for (let sosa = sosaStart; sosa <= sosaEnd; sosa++) {
			const parentSosa = Math.floor(sosa / 2);
			const parentPid = sosaToPersonId.get(parentSosa);
			if (!parentPid) continue;
			const parents = parentsByChild.get(parentPid) ?? [];
			// sosa even → "father" slot (parents[0]); odd → "mother" (parents[1]).
			const slot = sosa % 2 === 0 ? 0 : 1;
			const ancestorPid = parents[slot];
			if (!ancestorPid) continue;
			const ancestor = personById.get(ancestorPid);
			if (!ancestor) continue;
			sosaToPersonId.set(sosa, ancestorPid);

			const idxInRing = sosa - sosaStart;
			const startAngle = ARC_START + idxInRing * wedgeArc;
			wedges.push({
				person: ancestor,
				generation: gen,
				inner_r: gen * ringWidth,
				outer_r: (gen + 1) * ringWidth,
				start_angle: startAngle,
				end_angle: startAngle + wedgeArc
			});
		}
	}

	return { wedges, center, size };
}

/**
 * SVG path string for a fan wedge: a four-segment annular sector.
 * Angles are measured from 12 o'clock clockwise; we map them to
 * SVG's "from 3 o'clock counter-clockwise" via `cos / -sin`.
 */
export function fanWedgePath(w: FanWedge, center: { x: number; y: number }): string {
	const { inner_r, outer_r, start_angle, end_angle } = w;
	if (inner_r === 0) {
		// Center wedge is a half-disk.
		const x1 = center.x + outer_r * Math.sin(start_angle);
		const y1 = center.y - outer_r * Math.cos(start_angle);
		const x2 = center.x + outer_r * Math.sin(end_angle);
		const y2 = center.y - outer_r * Math.cos(end_angle);
		const largeArc = end_angle - start_angle > Math.PI ? 1 : 0;
		return `M ${center.x} ${center.y} L ${x1} ${y1} A ${outer_r} ${outer_r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
	}
	const ix1 = center.x + inner_r * Math.sin(start_angle);
	const iy1 = center.y - inner_r * Math.cos(start_angle);
	const ox1 = center.x + outer_r * Math.sin(start_angle);
	const oy1 = center.y - outer_r * Math.cos(start_angle);
	const ix2 = center.x + inner_r * Math.sin(end_angle);
	const iy2 = center.y - inner_r * Math.cos(end_angle);
	const ox2 = center.x + outer_r * Math.sin(end_angle);
	const oy2 = center.y - outer_r * Math.cos(end_angle);
	const largeArc = end_angle - start_angle > Math.PI ? 1 : 0;
	return [
		`M ${ix1} ${iy1}`,
		`L ${ox1} ${oy1}`,
		`A ${outer_r} ${outer_r} 0 ${largeArc} 1 ${ox2} ${oy2}`,
		`L ${ix2} ${iy2}`,
		`A ${inner_r} ${inner_r} 0 ${largeArc} 0 ${ix1} ${iy1}`,
		'Z'
	].join(' ');
}

/** Mid-arc point — convenient for placing labels inside a wedge. */
export function fanWedgeLabelPosition(
	w: FanWedge,
	center: { x: number; y: number }
): { x: number; y: number; rotate: number } {
	const midAngle = (w.start_angle + w.end_angle) / 2;
	const midRadius = (w.inner_r + w.outer_r) / 2;
	const x = center.x + midRadius * Math.sin(midAngle);
	const y = center.y - midRadius * Math.cos(midAngle);
	// Rotate the label so it reads roughly along the radius; clamp
	// to [-90°, 90°] for legibility (no upside-down text).
	const rotateDeg = (midAngle * 180) / Math.PI;
	const clamped = rotateDeg > 90 ? rotateDeg - 180 : rotateDeg < -90 ? rotateDeg + 180 : rotateDeg;
	return { x, y, rotate: clamped };
}
