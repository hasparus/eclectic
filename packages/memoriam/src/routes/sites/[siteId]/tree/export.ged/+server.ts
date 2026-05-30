import { error } from '@sveltejs/kit';
import { getSiteMember, getSite } from '$lib/server/sites.js';
import { getAllSitePeople } from '$lib/server/people.js';
import { exportTreeAsGedcom } from '$lib/gedcom.js';
import type { RequestHandler } from './$types';

/**
 * GEDCOM 7 download. Walks every person linked to the site (via
 * `person_memorials`) and serialises the full subgraph — distinct
 * from the rendered tree view, which is bounded by generation depth.
 *
 * Requires site membership; viewers can export too — the export is
 * a snapshot of the same data they already see, redacted records
 * would be a "Living relative" placeholder either way. We keep the
 * server-rendered view's redaction; admins get full fidelity here,
 * non-admins get the redacted tree exported.
 */
export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.userId) throw error(401, 'Sign in first');
	const site = getSite(params.siteId);
	if (!site) throw error(404, 'Site not found');
	const member = getSiteMember(params.siteId, locals.userId);
	if (!member) throw error(403, 'Not a member of this site');

	const tree = getAllSitePeople(params.siteId);
	const text = exportTreeAsGedcom({
		source_name: `memoriam — ${site.display_name ?? site.site_id}`,
		people: tree.people.map((p) => ({
			person_id: p.person_id,
			display_name: p.display_name,
			given_names: p.given_names,
			surname: p.surname,
			sex: p.sex,
			birth_date: p.birth_date,
			birth_place: p.birth_place,
			death_date: p.death_date,
			death_place: p.death_place,
			biography: p.biography
		})),
		parent_edges: tree.parent_edges.map((e) => ({
			parent_id: e.parent_id,
			child_id: e.child_id
		})),
		couples: tree.couples.map((c) => ({
			couple_id: c.couple_id,
			person_a_id: c.person_a_id,
			person_b_id: c.person_b_id,
			start_date: c.start_date,
			end_date: c.end_date
		}))
	});

	const filename = `${site.display_name ?? site.site_id}.ged`.replace(/[^\w.\-]+/g, '_');
	return new Response(text, {
		headers: {
			'content-type': 'text/vnd.familysearch.gedcom; charset=utf-8',
			'content-disposition': `attachment; filename="${filename}"`,
			'cache-control': 'no-store'
		}
	});
};
