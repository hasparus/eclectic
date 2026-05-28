import { error, redirect } from '@sveltejs/kit';
import { getSite, getSiteMember } from '$lib/server/sites.js';
import { getSiteSubjectId, getTreeRootedAt, getPerson } from '$lib/server/people.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	if (!locals.userId) {
		throw redirect(303, `/signin?next=${encodeURIComponent(url.pathname)}`);
	}

	const site = getSite(params.siteId);
	if (!site) throw error(404, 'Site not found');

	const member = getSiteMember(params.siteId, locals.userId);
	if (!member) throw error(403, 'Not a member of this site');

	const subjectId = getSiteSubjectId(params.siteId);
	const tree = subjectId ? getTreeRootedAt(subjectId, 4) : null;
	const subject = subjectId ? getPerson(subjectId) : null;

	return {
		site,
		current_user_id: locals.userId,
		current_user_role: member.role,
		can_edit: member.role === 'owner' || member.role === 'editor',
		subject,
		tree
	};
};
