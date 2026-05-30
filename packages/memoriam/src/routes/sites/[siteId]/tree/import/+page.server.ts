import { error, redirect } from '@sveltejs/kit';
import { getSite, getSiteMember } from '$lib/server/sites.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	if (!locals.userId) {
		throw redirect(303, `/signin?next=${encodeURIComponent(url.pathname)}`);
	}
	const site = getSite(params.siteId);
	if (!site) throw error(404, 'Site not found');
	const member = getSiteMember(params.siteId, locals.userId);
	if (!member) throw error(403, 'Not a member of this site');
	const canEdit = member.role === 'owner' || member.role === 'editor';
	if (!canEdit) throw error(403, 'Editors and owners only');

	return { site };
};
