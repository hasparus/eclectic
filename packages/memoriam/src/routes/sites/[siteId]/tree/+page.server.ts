import { error, redirect } from '@sveltejs/kit';
import { getSite, getSiteMember } from '$lib/server/sites.js';
import {
	getSiteSubjectId,
	getTreeRootedAt,
	getPerson,
	redactTree
} from '$lib/server/people.js';
import { ensureSiteTreeDoc } from '$lib/server/automerge_server.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.userId) {
		throw redirect(303, `/signin?next=${encodeURIComponent(url.pathname)}`);
	}

	const site = getSite(params.siteId);
	if (!site) throw error(404, 'Site not found');

	const member = getSiteMember(params.siteId, locals.userId);
	if (!member) throw error(403, 'Not a member of this site');

	const canEdit = member.role === 'owner' || member.role === 'editor';
	const subjectId = getSiteSubjectId(params.siteId);
	const rawTree = subjectId ? getTreeRootedAt(subjectId, 4) : null;
	const subject = subjectId ? getPerson(subjectId) : null;

	// Apply living-relative redaction for viewers. Admins (owner /
	// editor) see full-fidelity records; viewers see "Living relative"
	// placeholders for anyone where `isLikelyLiving` is true. The
	// site's subject is always shown in full — it's the focal point
	// of the memorial, the admin may simply not have entered a death
	// date yet, and hiding it would render the page meaningless.
	const tree = rawTree && !canEdit ? redactTree(rawTree, subjectId) : rawTree;

	// Materialise (or load) the per-site Automerge doc — the client
	// will subscribe via WebSocket so live changes from other tabs /
	// users appear without an HTTP round-trip. The URL is the only
	// thing the client needs to find the doc in its local repo.
	const doc_url = await ensureSiteTreeDoc(params.siteId);

	return {
		site,
		current_user_id: locals.userId,
		current_user_role: member.role,
		can_edit: canEdit,
		subject,
		tree,
		doc_url
	};
};
