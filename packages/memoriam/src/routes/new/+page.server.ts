import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const parentData = await parent();
	const isAdmin = parentData.is_admin ?? false;

	if (!locals.siteId) {
		throw error(404, 'No memorial found for this address.');
	}

	if (!isAdmin) {
		throw redirect(303, '/');
	}

	const { getSharedDocuments } = await import('$lib/api.remote.js');
	const sharedDocuments = await getSharedDocuments();

	return {
		is_admin: isAdmin,
		shared_documents: sharedDocuments
	};
};
