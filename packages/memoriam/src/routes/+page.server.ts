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

	return {
		...result,
		is_admin: isAdmin
	};
};
