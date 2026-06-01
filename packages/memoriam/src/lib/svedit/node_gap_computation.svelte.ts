/**
 * Gap computation and viewport-aware positioning for node-array
 * insertion markers. Called once from Svedit.svelte during init.
 *
 * ## Why this exists
 *
 * CSS anchor positioning is O(N) — the browser must resolve
 * anchor() functions for every positioned element on layout. Gap
 * markers (NodeGapMarkers) also grow at O(N). At ~200+ nodes this
 * causes noticeable frame drops during scroll and resize; at 500+
 * it's unusable.
 *
 * ## Design principle: structurally stable DOM
 *
 * NodeGap elements are **always present** in the DOM when editable,
 * regardless of viewport position. This guarantees:
 * - Selection anchors survive scrolling (no DOM removal mid-drag)
 * - scrollTo can always target gap elements
 * - ui = f(doc_state, editable_state) — no viewport-driven DOM changes
 *
 * The viewport tracker drives **lazy positioning**: only near-viewport
 * gaps receive CSS anchor positioning (via NodeGap's `positioned`
 * prop). Off-viewport gaps remain as zero-size absolute elements
 * with no layout cost. Gap markers (NodeGapMarkers) are only
 * computed for visible indices.
 */

import type Session from './Session.svelte.js';
import type { DocumentPath } from './types.d.ts';

type Path = ReadonlyArray<string | number>;

interface Gap {
	key: string;
	path: Path;
	offset: number;
	type: 'gap-empty' | 'gap-edge' | 'gap-mid';
	vars: string;
	is_first: boolean;
	is_last: boolean;
	has_pair: boolean;
}

/**
 * Minimal shape of the `svedit` context this module reaches into.
 * The full `Svedit.svelte` component exposes more, but we want a
 * narrow surface for the rest of the file to type-check against.
 */
interface SveditContext {
	session: Session & {
		document_id?: string;
		doc: { nodes: Record<string, any> };
		schema: Record<string, any>;
		selection?: { type: string; path: Path; anchor_offset: number; focus_offset: number } | null;
		get: (path: Path) => unknown;
		inspect: (path: Path) => { kind?: string; type?: string } | null;
	};
	editable: boolean;
	canvas_el?: HTMLElement | null;
	is_near_viewport?: (path: Path) => boolean;
	insertion_gap_data?: {
		get_gaps: (path_str: string) => { gaps: Gap[] };
		readonly caret_gap_key: string | null;
	};
}

/**
 * Overscan margin around the viewport (px). Nodes within this
 * distance get anchor positioning + gap markers. 500px is the
 * tested sweet spot for fast-scroll buffering without measurable
 * FPS impact at ≤1000 nodes.
 */
const DEFAULT_OVERSCAN_PX = 500;

const NODE_SELECTOR = '[data-type="node"][data-path]';

/** Cap synchronous getBoundingClientRect calls during initial setup. */
const MAX_SYNC_CHECKS = 30;

/**
 * Debounce before bumping the reactive `version` after IO
 * visibility changes. 20ms coalesces rapid IO callbacks into one
 * version bump.
 */
const VERSION_DEBOUNCE_MS = 20;

/** "root.prop.0" → `{ array_path: "root.prop", child_index: 0 }`. */
function parse_node_path(path: string): { array_path: string; child_index: number } | null {
	const dot = path.lastIndexOf('.');
	if (dot < 0) return null;
	const child_index = parseInt(path.slice(dot + 1), 10);
	if (Number.isNaN(child_index)) return null;
	return { array_path: path.slice(0, dot), child_index };
}

/**
 * Root-level array children have paths with exactly 2 dots — e.g.
 * "page_1.body.0". Deeper nodes (4+ dots) are skipped because
 * their visibility is inferred from the root ancestor.
 */
function is_root_array_child(path_str: string): boolean {
	let dots = 0;
	for (let i = 0; i < path_str.length; i++) {
		if (path_str[i] === '.' && ++dots > 2) return false;
	}
	return dots === 2;
}

interface VisibilityCuller {
	readonly visible_child_indices: Map<string, Set<number>>;
	readonly doc_snapshot: unknown | null;
	is_near_viewport: (path: Path) => boolean;
}

function create_visibility_culler(svedit: SveditContext): VisibilityCuller {
	const index_map = new Map<string, Set<number>>(); // eslint-disable-line svelte/prefer-svelte-reactivity
	/**
	 * Read-optimised set for is_near_viewport (called 1000× per
	 * version bump). A single Set.has(string) is faster than
	 * Map.get + Set.has.
	 */
	const visible_roots = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity

	let _ver = 0;
	let version = $state.raw(0);
	let doc_snapshot = $state.raw<unknown | null>(null);
	let version_timer = 0;

	function process_entries(entries: IntersectionObserverEntry[]): void {
		let did_change = false;
		for (const entry of entries) {
			const el = entry.target as HTMLElement;
			const path = el.dataset.path;
			if (!path) continue;
			const parsed = parse_node_path(path);
			if (!parsed) continue;

			if (entry.isIntersecting) {
				visible_roots.add(path);
				let set = index_map.get(parsed.array_path);
				if (!set) index_map.set(parsed.array_path, (set = new Set())); // eslint-disable-line svelte/prefer-svelte-reactivity
				if (!set.has(parsed.child_index)) {
					set.add(parsed.child_index);
					did_change = true;
				}
			} else {
				visible_roots.delete(path);
				const set = index_map.get(parsed.array_path);
				if (set && set.delete(parsed.child_index)) {
					did_change = true;
					if (set.size === 0) index_map.delete(parsed.array_path);
				}
			}
		}
		if (did_change) {
			clearTimeout(version_timer);
			version_timer = window.setTimeout(() => {
				version = ++_ver;
				doc_snapshot = svedit.session.doc;
			}, VERSION_DEBOUNCE_MS);
		}
	}

	/**
	 * Query existing DOM nodes, observe root-level ones with the IO,
	 * and sync-check the first batch for instant initial visibility.
	 *
	 * The sync check ensures above-the-fold nodes are marked visible
	 * immediately, without waiting for the async IO callback. Capped
	 * at MAX_SYNC_CHECKS to avoid layout thrashing.
	 */
	function setup_observation(io: IntersectionObserver): void {
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		let sync_checked = 0;

		for (const el of document.querySelectorAll(NODE_SELECTOR)) {
			const node_el = el as HTMLElement;
			const path = node_el.dataset.path;
			if (!path || !is_root_array_child(path)) continue;

			io.observe(node_el);

			if (sync_checked < MAX_SYNC_CHECKS) {
				const parsed = parse_node_path(path);
				if (parsed) {
					const rect = node_el.getBoundingClientRect();
					const visible =
						rect.bottom >= -DEFAULT_OVERSCAN_PX &&
						rect.top <= vh + DEFAULT_OVERSCAN_PX &&
						rect.right >= -DEFAULT_OVERSCAN_PX &&
						rect.left <= vw + DEFAULT_OVERSCAN_PX;
					if (visible) {
						visible_roots.add(path);
						let set = index_map.get(parsed.array_path);
						if (!set) index_map.set(parsed.array_path, (set = new Set())); // eslint-disable-line svelte/prefer-svelte-reactivity
						set.add(parsed.child_index);
					}
				}
				sync_checked++;
			}
		}
	}

	// Uses $effect (not $effect.pre) because setup_observation needs
	// the DOM live. Svelte flushes effects before the first browser
	// paint, so the immediate version bump here makes overlays
	// appear with zero flash.
	//
	// Depends only on `svedit.editable`. The IO stays alive across
	// document mutations.
	$effect(() => {
		if (!svedit.editable) {
			index_map.clear();
			version = ++_ver;
			doc_snapshot = null;
			return;
		}

		index_map.clear();

		const io = new IntersectionObserver(process_entries, {
			rootMargin: `${DEFAULT_OVERSCAN_PX}px`
		});

		setup_observation(io);
		doc_snapshot = svedit.session.doc;
		version = ++_ver;

		const canvas =
			svedit.canvas_el || (document.querySelector('.svedit-canvas') as HTMLElement | null);
		let mo: MutationObserver | null = null;

		// The MO start is deferred by one rAF. During initial Svelte
		// mount, hundreds of DOM mutations fire as components render —
		// setup_observation() already handled the initial scan.
		let deferred_raf = 0;

		if (canvas) {
			mo = new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const added of m.addedNodes) {
						if (added.nodeType !== Node.ELEMENT_NODE) continue;
						const el = added as HTMLElement;
						if (el.matches?.(NODE_SELECTOR) && el.dataset.path && is_root_array_child(el.dataset.path)) {
							io.observe(el);
						}
						for (const child of el.querySelectorAll?.(NODE_SELECTOR) ?? []) {
							const child_el = child as HTMLElement;
							if (child_el.dataset.path && is_root_array_child(child_el.dataset.path)) {
								io.observe(child_el);
							}
						}
					}
				}
			});
			deferred_raf = requestAnimationFrame(() => {
				mo!.observe(canvas, { childList: true, subtree: true });
			});
		}

		return () => {
			clearTimeout(version_timer);
			cancelAnimationFrame(deferred_raf);
			io.disconnect();
			mo?.disconnect();
			index_map.clear();
			visible_roots.clear();
		};
	});

	// Reactive bridge: ensures gap-building re-runs on structural
	// doc changes (node add/delete) even when the IO doesn't fire.
	$effect.pre(() => {
		doc_snapshot = svedit.session.doc;
	});

	function is_near_viewport(path: Path): boolean {
		if (path.length < 3) return true;
		void version;
		// Content under non-tracked arrays is always visible.
		const parent_array = `${path[0]}.${path[1]}`;
		if (!index_map.has(parent_array)) return true;
		const root_key = `${path[0]}.${path[1]}.${path[2]}`;
		return visible_roots.has(root_key);
	}

	return {
		get visible_child_indices() {
			void version;
			return index_map;
		},
		get doc_snapshot() {
			return doc_snapshot;
		},
		is_near_viewport
	};
}

/* --------------------------------------------------------------------- */
/* Gap computation                                                       */
/* --------------------------------------------------------------------- */

export function create_gap_computation(svedit: SveditContext): void {
	const culler = create_visibility_culler(svedit);

	svedit.is_near_viewport = culler.is_near_viewport;

	const caret_gap_key = $derived.by(() => {
		const s = svedit.session.selection;
		if (s?.type !== 'node' || s.anchor_offset !== s.focus_offset) return null;
		return `${s.path.join('.')}-gap-${s.anchor_offset}`;
	});

	/**
	 * Per-path reactive gap data. Each NodeGapMarkers instance
	 * subscribes to its own PathGapData signal, so when gaps
	 * change only the ~10-15 affected paths re-render — O(K) not
	 * O(M=1200).
	 */
	class PathGapData {
		gaps = $state.raw<Gap[]>([]);
	}

	const path_gap_signals = new Map<string, PathGapData>(); // eslint-disable-line svelte/prefer-svelte-reactivity

	function get_or_create_gap_signal(path_str: string): PathGapData {
		let sig = path_gap_signals.get(path_str);
		if (!sig) {
			sig = new PathGapData();
			path_gap_signals.set(path_str, sig);
		}
		return sig;
	}

	// Distribute gap data to per-path signals. Runs before DOM
	// updates so NodeGapMarkers sees fresh data in the same render
	// pass.
	$effect.pre(() => {
		const new_gaps = build_all_gaps();
		const seen = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
		for (const [path_str, gaps] of new_gaps) {
			seen.add(path_str);
			get_or_create_gap_signal(path_str).gaps = gaps;
		}
		for (const [path_str, sig] of path_gap_signals) {
			if (!seen.has(path_str) && sig.gaps.length > 0) {
				sig.gaps = [];
			}
		}
	});

	svedit.insertion_gap_data = {
		get_gaps: get_or_create_gap_signal,
		get caret_gap_key() {
			return caret_gap_key;
		}
	};

	function build_all_gaps(): Map<string, Gap[]> {
		if (!svedit.editable) return new Map();

		const by_path = new Map<string, Gap[]>(); // eslint-disable-line svelte/prefer-svelte-reactivity

		// Wait until the culler's visibility snapshot matches the
		// current doc.
		if (culler.doc_snapshot !== svedit.session.doc) return by_path;

		for (const [path_str, indices] of culler.visible_child_indices) {
			const gaps = build_array_gaps_culled(path_str, indices);
			if (gaps.length > 0) by_path.set(path_str, gaps);

			for (const child_idx of indices) {
				collect_nested_array_gaps(path_str, child_idx, by_path);
			}
		}

		// Walk doc-root `node` properties (page.nav, page.footer).
		const doc_id = svedit.session.document_id;
		if (!doc_id) return by_path;
		const doc_node = svedit.session.doc.nodes[doc_id];
		if (doc_node) {
			const doc_type_def = svedit.session.schema[doc_node.type];
			if (doc_type_def?.properties) {
				for (const [prop_name, prop_def] of Object.entries(
					doc_type_def.properties as Record<string, { type: string }>
				)) {
					if (prop_def.type === 'node' && doc_node[prop_name]) {
						collect_node_gaps(`${doc_id}.${prop_name}`, doc_node[prop_name], by_path);
					}
				}
			}
		}

		return by_path;
	}

	function collect_nested_array_gaps(
		array_path_str: string,
		child_index: number,
		by_path: Map<string, Gap[]>
	): void {
		const array_path = array_path_str.split('.');
		const node_ids = svedit.session.get(array_path) as string[] | undefined;
		if (!Array.isArray(node_ids) || child_index >= node_ids.length) return;

		collect_node_gaps(`${array_path_str}.${child_index}`, node_ids[child_index], by_path);
	}

	function collect_node_gaps(
		node_path_str: string,
		node_id: string,
		by_path: Map<string, Gap[]>
	): void {
		const node = svedit.session.doc.nodes[node_id];
		if (!node) return;

		const type_def = svedit.session.schema[node.type];
		if (!type_def?.properties) return;

		for (const [prop_name, prop_def] of Object.entries(
			type_def.properties as Record<string, { type: string }>
		)) {
			const prop_path_str = `${node_path_str}.${prop_name}`;

			if (prop_def.type === 'node') {
				const ref_id = node[prop_name];
				if (ref_id) collect_node_gaps(prop_path_str, ref_id, by_path);
			} else if (prop_def.type === 'node_array') {
				if (by_path.has(prop_path_str)) continue;

				const ids = (node[prop_name] || []) as string[];
				const gaps = emit_gaps(prop_path_str, prop_path_str.split('.'), ids.length, () => true);
				if (gaps.length > 0) by_path.set(prop_path_str, gaps);

				for (let i = 0; i < ids.length; i++) {
					collect_node_gaps(`${prop_path_str}.${i}`, ids[i], by_path);
				}
			}
		}
	}

	function build_array_gaps_culled(
		array_path_str: string,
		visible_indices: Set<number>
	): Gap[] {
		const array_path = array_path_str.split('.');
		try {
			const info = svedit.session.inspect(array_path);
			if (info?.kind !== 'property' || info?.type !== 'node_array') return [];
		} catch {
			return [];
		}
		const node_ids = svedit.session.get(array_path) as unknown[];
		if (!Array.isArray(node_ids)) return [];

		return emit_gaps(array_path_str, array_path, node_ids.length, (offset, count) => {
			const prev_visible = offset > 0 && visible_indices.has(offset - 1);
			const next_visible = offset < count && visible_indices.has(offset);
			return prev_visible || next_visible;
		});
	}

	function emit_gaps(
		array_path_str: string,
		array_path: Path,
		count: number,
		is_visible: (offset: number, count: number) => boolean
	): Gap[] {
		const anchor_prefix = `--${array_path.join('-')}`;
		const g_prefix = `--g-${array_path.join('-')}`;
		const container_var = `;--_c:${anchor_prefix}`;
		const has_pair = count >= 2;
		const pair_vars = has_pair ? `;--_f:${anchor_prefix}-0;--_s:${anchor_prefix}-1` : '';

		const gaps: Gap[] = [];

		if (count === 0) {
			gaps.push({
				key: `${array_path_str}-gap-0`,
				path: array_path,
				offset: 0,
				type: 'gap-empty',
				vars: `--_ct:${g_prefix}-0-gap-before;--_a:${anchor_prefix}-0${container_var}`,
				is_first: true,
				is_last: true,
				has_pair: false
			});
			return gaps;
		}

		for (let offset = 0; offset <= count; offset++) {
			if (!is_visible(offset, count)) continue;

			const is_first = offset === 0;
			const is_last = offset === count;
			const g_anchor =
				offset === 0
					? `${g_prefix}-0-gap-before`
					: `${g_prefix}-${offset - 1}-gap-after`;

			let type: Gap['type'];
			let vars: string;

			if (is_first || is_last) {
				type = 'gap-edge';
				const adjacent = is_first
					? `${anchor_prefix}-0`
					: `${anchor_prefix}-${count - 1}`;
				vars = `--_ct:${g_anchor};--_a:${adjacent}${container_var}${pair_vars}`;
			} else {
				type = 'gap-mid';
				const p_anchor = `${anchor_prefix}-${offset - 1}`;
				const n_anchor = `${anchor_prefix}-${offset}`;
				vars = `--_ct:${g_anchor};--_p:${p_anchor};--_n:${n_anchor}${container_var}${pair_vars}`;
			}

			gaps.push({
				key: `${array_path_str}-gap-${offset}`,
				path: array_path,
				offset,
				type,
				vars,
				is_first,
				is_last,
				has_pair
			});
		}

		return gaps;
	}
}
