import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const parentData = await parent();
	const isAdmin = parentData.is_admin ?? false;

	if (!locals.siteId) {
		throw error(404, 'No memorial found for this address.');
	}

	const { getHomeDocument } = await import('$lib/api.remote.js');
	const result = await getHomeDocument();

	// Per-site page-edit broadcast doc — every other tab on this
	// site subscribes via WebSocket and calls `invalidateAll()`
	// when this doc ticks (i.e. when any page is saved / renamed /
	// deleted). Same Automerge plumbing as the tree feature; the
	// doc itself is intentionally tiny (`{ updated_at }`).
	const { ensureSitePageBroadcastDoc } = await import('$lib/server/automerge_server.js');
	const page_doc_url = await ensureSitePageBroadcastDoc(locals.siteId);

	return {
		...result,
		is_admin: isAdmin,
		page_doc_url
	};
};
