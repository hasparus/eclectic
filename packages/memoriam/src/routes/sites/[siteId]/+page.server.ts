import { error, redirect } from '@sveltejs/kit';
import { getSite, getSiteMember } from '$lib/server/sites.js';
import { listMembers, listOutstandingInvites } from '$lib/server/members.js';
import { listShortCodesForSite } from '$lib/server/short_codes.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	if (!locals.userId) {
		throw redirect(303, `/signin?next=${encodeURIComponent(url.pathname)}`);
	}

	const site = getSite(params.siteId);
	if (!site) throw error(404, 'Site not found');

	const member = getSiteMember(params.siteId, locals.userId);
	if (!member) throw error(403, 'Not a member of this site');

	return {
		site,
		current_user_id: locals.userId,
		current_user_role: member.role,
		members: listMembers(params.siteId),
		invites: listOutstandingInvites(params.siteId),
		short_codes: listShortCodesForSite(params.siteId)
	};
};
