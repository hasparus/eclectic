import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
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
