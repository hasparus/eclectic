import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const parentData = await parent();
	const hasBackend = parentData.has_backend;
	const isAdmin = parentData.is_admin ?? false;

	if (!hasBackend) {
		return {
			has_backend: hasBackend,
			is_admin: isAdmin,
			document: null,
			slug: null
		};
	}

	if (!locals.siteId) {
		throw error(404, 'No memorial found for this address.');
	}

	const { getHomeDocument } = await import('$lib/api.remote.js');
	const result = await getHomeDocument();

	return {
		...result,
		has_backend: hasBackend,
		is_admin: isAdmin
	};
};
