import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
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

	const { getHomeDocument } = await import('$lib/api.remote.js');
	const result = await getHomeDocument();

	return {
		...result,
		has_backend: hasBackend,
		is_admin: isAdmin
	};
};
