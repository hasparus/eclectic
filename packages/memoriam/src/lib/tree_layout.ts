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
