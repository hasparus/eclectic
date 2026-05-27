import { redirect } from '@sveltejs/kit';
import { listUserSites } from '$lib/server/sites.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.userId) {
		throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
	}
	return {
		sites: listUserSites(locals.userId),
		user_email: locals.userEmail
	};
};
