import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const parentData = await parent();
	const hasBackend = parentData.has_backend;
	const isAdmin = parentData.is_admin ?? false;

	if (!hasBackend) {
		return {
			has_backend: hasBackend,
			is_admin: isAdmin,
			shared_documents: null
		};
	}

	if (!locals.siteId) {
		throw error(404, 'No memorial found for this address.');
	}

	if (!isAdmin) {
		throw redirect(303, '/');
	}

	const { getSharedDocuments } = await import('$lib/api.remote.js');
	const sharedDocuments = await getSharedDocuments();

	return {
		has_backend: hasBackend,
		is_admin: isAdmin,
		shared_documents: sharedDocuments
	};
};
