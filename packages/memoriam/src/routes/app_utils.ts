import type { Session } from 'svedit';

type Path = (string | number)[];

interface AncestorWalkPaths {
	fullPath: Path;
	startPath: Path;
}

/**
 * Build the full path (including selected node index) and the starting
 * node_array path for walking up the tree from the current selection.
 *
 * For node selections the index lives in anchor_offset, not in the path.
 * For text / property selections the path already contains all indices.
 */
function getAncestorWalkPaths(session: Session): AncestorWalkPaths | null {
	const selection = session.selection as any;
	if (!selection) return null;

	if (selection.type === 'node') {
		if (selection.anchor_offset === selection.focus_offset) return null;
		return {
			fullPath: [...selection.path, selection.anchor_offset],
			startPath: selection.path
		};
	}

	// For text/property selections, go up to the containing node_array.
	if (selection.path.length > 3) {
		return {
			fullPath: selection.path,
			startPath: selection.path.slice(0, -2)
		};
	}

	return null;
}

function getNodeIndexAt(fullPath: Path, ancestorPath: Path): number | null {
	if (fullPath.length <= ancestorPath.length) return null;
	return parseInt(String(fullPath[ancestorPath.length]));
}

export interface SwitchableTarget {
	node: any;
	node_array_path: Path;
	node_index: number;
}

/**
 * Find the closest ancestor node whose type can be switched (lives in
 * a node_array with multiple node_types).
 */
export function getClosestSwitchableType(session: Session): SwitchableTarget | null {
	const paths = getAncestorWalkPaths(session);
	if (!paths) return null;

	const { fullPath, startPath } = paths;

	let path: Path | null = startPath;
	while (path && path.length >= 2) {
		const schema = (session as any).inspect(path);
		if (schema?.type === 'node_array' && schema.node_types?.length > 1) {
			const nodeIndex = getNodeIndexAt(fullPath, path);
			if (nodeIndex !== null) {
				const node = (session as any).get([...path, nodeIndex]);
				if (node) {
					return { node, node_array_path: path, node_index: nodeIndex };
				}
			}
		}
		path = path.slice(0, -2);
	}

	return null;
}

/**
 * Get the colorset node for the current selection. A colorset node has
 * a `colorset` property. Walks up the tree to find the nearest ancestor
 * with one.
 */
export function getColorsetNode(session: Session): any | null {
	const selected = (session as any).selected_node;
	if (!selected) return null;

	if ('colorset' in selected) {
		return selected;
	}

	const selection = session.selection as any;
	let path: Path;
	if (selection.type === 'node') {
		path = selection.path.slice(0, -1);
	} else {
		path = selection.path.slice(0, -3);
	}

	while (path && path.length > 0) {
		const node = (session as any).get(path);
		if (node && 'colorset' in node) {
			return node;
		}
		path = path.slice(0, -2);
	}

	return null;
}

/**
 * Find the closest ancestor node whose layout can be switched (has a
 * layout property and `node_layouts[type] > 1`).
 */
export function getClosestSwitchableLayout(
	session: Session,
	sessionConfig: { node_layouts?: Record<string, number> }
): SwitchableTarget | null {
	const paths = getAncestorWalkPaths(session);
	if (!paths) return null;

	const { fullPath, startPath } = paths;

	let path: Path | null = startPath;
	while (path && path.length >= 2) {
		const nodeIndex = getNodeIndexAt(fullPath, path);
		if (nodeIndex !== null) {
			const node = (session as any).get([...path, nodeIndex]);
			if (node?.layout && (sessionConfig.node_layouts?.[node.type] ?? 0) > 1) {
				return { node, node_array_path: path, node_index: nodeIndex };
			}
		}
		path = path.slice(0, -2);
	}

	return null;
}
