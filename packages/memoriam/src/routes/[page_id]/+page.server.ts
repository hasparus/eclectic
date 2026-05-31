import { error, redirect } from '@sveltejs/kit';
import { getDocument } from '$lib/api.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, locals }) => {
	const parentData = await parent();
	const isAdmin = parentData.is_admin ?? false;

	if (!locals.siteId) {
		throw error(404, 'No memorial found for this address.');
	}

	try {
		const result = await getDocument(params.page_id);

		if (result.redirect_to_slug) {
			throw redirect(301, `/${result.redirect_to_slug}`);
		}

		// Per-site page broadcast + per-document Automerge doc.
		// See the root `+page.server.ts` for the design note.
		const { ensureSitePageBroadcastDoc, ensureDocumentDoc } = await import(
			'$lib/server/automerge_server.js'
		);
		const page_doc_url = await ensureSitePageBroadcastDoc(locals.siteId);
		const document_doc_url = await ensureDocumentDoc(
			locals.siteId,
			result.document.document_id
		);

		return {
			document: result.document,
			slug: result.slug,
			is_admin: isAdmin,
			page_doc_url,
			document_doc_url
		};
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		throw error(404, 'Page not found');
	}
};
