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

	// Per-site page-edit broadcast doc (drives `invalidateAll()`).
	// Plus per-document Automerge doc for THIS page — svedit's
	// Session attaches to the handle and mirrors local ops, so
	// concurrent editors see each other's edits at the op level
	// (without a full page reload).
	const { ensureSitePageBroadcastDoc, ensureDocumentDoc } = await import(
		'$lib/server/automerge_server.js'
	);
	const page_doc_url = await ensureSitePageBroadcastDoc(locals.siteId);
	const document_doc_url = await ensureDocumentDoc(locals.siteId, result.document.document_id);

	return {
		...result,
		is_admin: isAdmin,
		page_doc_url,
		document_doc_url
	};
};
