import { documentSchema } from '$lib/document_schema.js';

/**
 * Collect all node ids reachable from a root node by walking node /
 * node_array properties and annotation references, preserving
 * first-seen traversal order.
 */
export function collectNodeIdsInOrder(
	rootId: string,
	nodes: Record<string, any>,
	excludeRoots?: Set<string>
): string[] {
	const collected: string[] = [];
	const seenIds = new Set<string>();
	const stack: string[] = [rootId];

	while (stack.length > 0) {
		const id = stack.pop();
		if (!id || seenIds.has(id)) continue;
		if (excludeRoots && excludeRoots.has(id) && id !== rootId) continue;

		seenIds.add(id);
		collected.push(id);

		const node = nodes[id];
		if (!node) continue;

		const typeSchema = (documentSchema as Record<string, any>)[node.type];
		if (!typeSchema) continue;

		const nextIds: string[] = [];

		for (const [propName, propDef] of Object.entries(typeSchema.properties) as [
			string,
			any
		][]) {
			const value = node[propName];
			if (value == null) continue;

			if (propDef.type === 'node' && typeof value === 'string') {
				nextIds.push(value);
			} else if (propDef.type === 'node_array' && Array.isArray(value)) {
				for (const childId of value) {
					nextIds.push(childId);
				}
			} else if (propDef.type === 'annotated_text' && value.annotations) {
				for (const annotation of value.annotations) {
					if (annotation.node_id) {
						nextIds.push(annotation.node_id);
					}
				}
			}
		}

		for (let i = nextIds.length - 1; i >= 0; i -= 1) {
			stack.push(nextIds[i]);
		}
	}

	return collected;
}
