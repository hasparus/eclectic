import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'memoriam-people-'));
	process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
	const platform = await import('$lib/server/platform_db.js');
	platform.closePlatformDb();
	const sites = await import('$lib/server/db.js');
	sites.closeAllDbs();
	rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

async function seedUser() {
	const { upsertUserByEmail } = await import('$lib/server/users.js');
	const u = upsertUserByEmail('test@example.com');
	return u.user_id;
}

describe('people module', () => {
	it('extend_genealogy_for_tree_v1 migration adds the new columns + couples table', async () => {
		const { getPlatformDb } = await import('$lib/server/platform_db.js');
		const db = getPlatformDb();

		const cols = db.prepare(`PRAGMA table_info(people)`).all() as { name: string }[];
		const colNames = new Set(cols.map((c) => c.name));
		for (const expected of ['sex', 'birth_date', 'birth_place', 'death_date', 'death_place', 'biography']) {
			expect(colNames.has(expected)).toBe(true);
		}

		const couples = db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'couples'`)
			.get() as { name: string } | undefined;
		expect(couples?.name).toBe('couples');

		const sitesCols = db.prepare(`PRAGMA table_info(sites)`).all() as { name: string }[];
		expect(sitesCols.some((c) => c.name === 'subject_person_id')).toBe(true);
	});

	it('createPerson inserts and grants owner access', async () => {
		const userId = await seedUser();
		const { createPerson, getPerson } = await import('$lib/server/people.js');

		const p = createPerson({
			owner_user_id: userId,
			display_name: 'Grandma Edith',
			given_names: 'Edith',
			surname: 'Holloway',
			sex: 'F',
			birth_date: '1925-04-12',
			death_date: '2018-11-03'
		});

		expect(p.person_id).toBeDefined();
		expect(p.display_name).toBe('Grandma Edith');
		expect(p.birth_year).toBe(1925);
		expect(p.death_year).toBe(2018);
		expect(p.is_living).toBe(0);

		const fetched = getPerson(p.person_id);
		expect(fetched?.display_name).toBe('Grandma Edith');
	});

	it('addParentEdge rejects a self-edge', async () => {
		const userId = await seedUser();
		const { createPerson, addParentEdge } = await import('$lib/server/people.js');
		const p = createPerson({ owner_user_id: userId, display_name: 'Solo' });
		expect(() => addParentEdge({ parent_id: p.person_id, child_id: p.person_id })).toThrow(
			/own parent/i
		);
	});

	it('addParentEdge rejects a cycle', async () => {
		const userId = await seedUser();
		const { createPerson, addParentEdge } = await import('$lib/server/people.js');
		const a = createPerson({ owner_user_id: userId, display_name: 'A' });
		const b = createPerson({ owner_user_id: userId, display_name: 'B' });
		const c = createPerson({ owner_user_id: userId, display_name: 'C' });
		// a → b → c (parent → child)
		addParentEdge({ parent_id: a.person_id, child_id: b.person_id });
		addParentEdge({ parent_id: b.person_id, child_id: c.person_id });
		// Adding c → a would close the cycle.
		expect(() => addParentEdge({ parent_id: c.person_id, child_id: a.person_id })).toThrow(
			/cycle/i
		);
	});

	it('createCouple normalises person ordering and dedupes', async () => {
		const userId = await seedUser();
		const { createPerson, createCouple } = await import('$lib/server/people.js');
		const a = createPerson({ owner_user_id: userId, display_name: 'A' });
		const b = createPerson({ owner_user_id: userId, display_name: 'B' });

		const ab = createCouple({ person_a_id: a.person_id, person_b_id: b.person_id });
		const ba = createCouple({ person_a_id: b.person_id, person_b_id: a.person_id });
		expect(ab.couple_id).toBe(ba.couple_id);
		// The canonical ordering is min(id) first.
		const [first, second] =
			a.person_id < b.person_id ? [a.person_id, b.person_id] : [b.person_id, a.person_id];
		expect(ab.person_a_id).toBe(first);
		expect(ab.person_b_id).toBe(second);
	});

	it('getTreeRootedAt walks ancestors + descendants + spouses', async () => {
		const userId = await seedUser();
		const { createPerson, addParentEdge, createCouple, getTreeRootedAt } = await import(
			'$lib/server/people.js'
		);

		// Three generations: grandfather → father, mother → focal → child.
		const grandpa = createPerson({ owner_user_id: userId, display_name: 'Grandpa' });
		const father = createPerson({ owner_user_id: userId, display_name: 'Father' });
		const mother = createPerson({ owner_user_id: userId, display_name: 'Mother' });
		const focal = createPerson({ owner_user_id: userId, display_name: 'Focal' });
		const spouse = createPerson({ owner_user_id: userId, display_name: 'Spouse' });
		const child = createPerson({ owner_user_id: userId, display_name: 'Child' });

		addParentEdge({ parent_id: grandpa.person_id, child_id: father.person_id });
		addParentEdge({ parent_id: father.person_id, child_id: focal.person_id });
		addParentEdge({ parent_id: mother.person_id, child_id: focal.person_id });
		addParentEdge({ parent_id: focal.person_id, child_id: child.person_id });
		addParentEdge({ parent_id: spouse.person_id, child_id: child.person_id });
		createCouple({ person_a_id: focal.person_id, person_b_id: spouse.person_id });

		const tree = getTreeRootedAt(focal.person_id, 4);
		const ids = new Set(tree.people.map((p) => p.person_id));
		expect(ids.has(grandpa.person_id)).toBe(true);
		expect(ids.has(father.person_id)).toBe(true);
		expect(ids.has(mother.person_id)).toBe(true);
		expect(ids.has(focal.person_id)).toBe(true);
		expect(ids.has(spouse.person_id)).toBe(true);
		expect(ids.has(child.person_id)).toBe(true);
		expect(tree.parent_edges).toHaveLength(5);
		expect(tree.couples).toHaveLength(1);
	});

	it('isLikelyLiving treats no-death + young birth as living', async () => {
		const { isLikelyLiving } = await import('$lib/server/people.js');
		expect(isLikelyLiving({ is_living: 1, death_date: null, death_year: null, birth_year: 1950 })).toBe(true);
		expect(isLikelyLiving({ is_living: 0, death_date: null, death_year: null, birth_year: 1990 })).toBe(true);
		expect(isLikelyLiving({ is_living: 0, death_date: null, death_year: null, birth_year: 1800 })).toBe(false);
		expect(isLikelyLiving({ is_living: 0, death_date: '2010-01-01', death_year: 2010, birth_year: 1930 })).toBe(false);
	});

	it('userCanEditPerson via site membership', async () => {
		const userId = await seedUser();
		const { createSite } = await import('$lib/server/sites.js');
		const { createPerson, userCanEditPerson, linkPersonToSite } = await import(
			'$lib/server/people.js'
		);
		const site = createSite({ ownerUserId: userId, displayName: 'Test' });
		const person = createPerson({ owner_user_id: userId, display_name: 'Linked' });

		// Direct owner grant via person_access works.
		expect(userCanEditPerson(person.person_id, userId)).toBe(true);

		// A different user with no access should be blocked.
		const { upsertUserByEmail } = await import('$lib/server/users.js');
		const otherUser = upsertUserByEmail('other@example.com');
		expect(userCanEditPerson(person.person_id, otherUser.user_id)).toBe(false);

		// Linking the person to a site the other user belongs to (as
		// editor) should grant transitive write access.
		const { getPlatformDb } = await import('$lib/server/platform_db.js');
		getPlatformDb()
			.prepare(
				`INSERT INTO site_members (site_id, user_id, role, created_at)
				 VALUES (?, ?, 'editor', ?)`
			)
			.run(site.site_id, otherUser.user_id, new Date().toISOString());
		linkPersonToSite(person.person_id, site.site_id);
		expect(userCanEditPerson(person.person_id, otherUser.user_id)).toBe(true);
	});

	it('removeParentEdge drops only the targeted edge', async () => {
		const userId = await seedUser();
		const { createPerson, addParentEdge, removeParentEdge, getTreeRootedAt } = await import(
			'$lib/server/people.js'
		);
		const a = createPerson({ owner_user_id: userId, display_name: 'A' });
		const b = createPerson({ owner_user_id: userId, display_name: 'B' });
		const c = createPerson({ owner_user_id: userId, display_name: 'C' });
		addParentEdge({ parent_id: a.person_id, child_id: b.person_id });
		addParentEdge({ parent_id: a.person_id, child_id: c.person_id });

		removeParentEdge(a.person_id, b.person_id);

		const tree = getTreeRootedAt(a.person_id, 4);
		const edgeSet = new Set(tree.parent_edges.map((e) => `${e.parent_id}-${e.child_id}`));
		expect(edgeSet.has(`${a.person_id}-${b.person_id}`)).toBe(false);
		expect(edgeSet.has(`${a.person_id}-${c.person_id}`)).toBe(true);
	});

	it('removeCouple drops only the targeted couple', async () => {
		const userId = await seedUser();
		const { createPerson, createCouple, removeCouple, getCoupleById, getTreeRootedAt } =
			await import('$lib/server/people.js');
		const a = createPerson({ owner_user_id: userId, display_name: 'A' });
		const b = createPerson({ owner_user_id: userId, display_name: 'B' });
		const c = createPerson({ owner_user_id: userId, display_name: 'C' });
		const ab = createCouple({ person_a_id: a.person_id, person_b_id: b.person_id });
		const ac = createCouple({ person_a_id: a.person_id, person_b_id: c.person_id });
		expect(getCoupleById(ab.couple_id)).not.toBeNull();

		removeCouple(ab.couple_id);

		expect(getCoupleById(ab.couple_id)).toBeNull();
		expect(getCoupleById(ac.couple_id)).not.toBeNull();
		const tree = getTreeRootedAt(a.person_id, 0);
		expect(tree.couples.map((c) => c.couple_id)).toEqual([ac.couple_id]);
	});

	it('deletePerson cascades to relationships, couples, memorials, and nulls subject_person_id', async () => {
		const userId = await seedUser();
		const { createSite } = await import('$lib/server/sites.js');
		const {
			createPerson,
			addParentEdge,
			createCouple,
			deletePerson,
			getPerson,
			getCoupleById,
			setSiteSubject,
			getSiteSubjectId,
			linkPersonToSite,
			getTreeRootedAt
		} = await import('$lib/server/people.js');

		const site = createSite({ ownerUserId: userId, displayName: 'Family' });
		const focal = createPerson({ owner_user_id: userId, display_name: 'Focal' });
		const parent = createPerson({ owner_user_id: userId, display_name: 'Parent' });
		const spouse = createPerson({ owner_user_id: userId, display_name: 'Spouse' });
		addParentEdge({ parent_id: parent.person_id, child_id: focal.person_id });
		const couple = createCouple({ person_a_id: focal.person_id, person_b_id: spouse.person_id });
		linkPersonToSite(focal.person_id, site.site_id);
		setSiteSubject(site.site_id, focal.person_id);

		// Sanity: the focal is the subject + has relationships before
		// we delete.
		expect(getSiteSubjectId(site.site_id)).toBe(focal.person_id);

		deletePerson(focal.person_id);

		expect(getPerson(focal.person_id)).toBeNull();
		// `subject_person_id` is nulled — the tree page can re-prompt
		// the empty-state CTA instead of crashing.
		expect(getSiteSubjectId(site.site_id)).toBeNull();
		// Edges and couples touching the focal are gone.
		expect(getCoupleById(couple.couple_id)).toBeNull();
		const remaining = getTreeRootedAt(parent.person_id, 4);
		const edgeSet = new Set(
			remaining.parent_edges.map((e) => `${e.parent_id}-${e.child_id}`)
		);
		expect(edgeSet.has(`${parent.person_id}-${focal.person_id}`)).toBe(false);
		// The parent itself survives — only the focal got deleted.
		expect(getPerson(parent.person_id)).not.toBeNull();
		expect(getPerson(spouse.person_id)).not.toBeNull();
	});
});
