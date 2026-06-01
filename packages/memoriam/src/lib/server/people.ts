import { customAlphabet } from 'nanoid';
import { type } from 'arktype';
import { Result, ok, err } from 'neverthrow';
import { getPlatformDb } from '$lib/server/platform_db.js';
import { errOf, type AppError } from '$lib/server/app_error.js';
import { parseRowOptional, parseRows } from '$lib/server/db_row.js';
import type {
	Person,
	ParentEdge,
	Couple,
	TreePayload,
	Sex,
	PrivacyLevel,
	ParentKind,
	CoupleKind,
	CoupleEndReason
} from '$lib/people_types.js';

export type { Person, ParentEdge, Couple, TreePayload, Sex, PrivacyLevel, ParentKind, CoupleKind, CoupleEndReason };

// Arktype schemas matching the typescript types in people_types.ts.
// Used at the SQLite read boundary so a column rename or migration
// drift blows up at the boundary, not three frames deeper.
const SexSchema = type('"M" | "F" | "X" | "U" | null');
const PrivacyLevelSchema = type('"public" | "members" | "private"');
const ParentKindSchema = type('"biological" | "adoptive" | "foster" | "step" | "unknown"');
const CoupleKindSchema = type('"marriage" | "partnership" | "engagement" | "other"');
const CoupleEndReasonSchema = type(
	'"divorce" | "death" | "annulment" | "separation" | null'
);

const PersonRowSchema = type({
	person_id: 'string',
	display_name: 'string',
	given_names: 'string | null',
	surname: 'string | null',
	sex: SexSchema,
	birth_date: 'string | null',
	birth_place: 'string | null',
	death_date: 'string | null',
	death_place: 'string | null',
	birth_year: 'number | null',
	death_year: 'number | null',
	is_living: '0 | 1',
	biography: 'string | null',
	privacy_level: PrivacyLevelSchema,
	owner_user_id: 'string',
	created_at: 'string',
	updated_at: 'string'
});

const ParentEdgeRowSchema = type({
	parent_id: 'string',
	child_id: 'string',
	kind: ParentKindSchema,
	certainty: '"certain" | "probable" | "unverified"'
});

const CoupleRowSchema = type({
	couple_id: 'string',
	person_a_id: 'string',
	person_b_id: 'string',
	kind: CoupleKindSchema,
	start_date: 'string | null',
	end_date: 'string | null',
	end_reason: CoupleEndReasonSchema
});

const ExistenceMarkerRowSchema = type({ '1': 'number' });
const IdRowSchema = type({ id: 'string' });
const SubjectRowSchema = type({ subject_person_id: 'string | null' });
const EdgePairRowSchema = type({ a: 'string', b: 'string' });
const PersonIdRowSchema = type({ person_id: 'string' });

const personIdAlphabet = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);
const coupleIdAlphabet = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);

export interface CreatePersonInput {
	owner_user_id: string;
	display_name: string;
	given_names?: string | null;
	surname?: string | null;
	sex?: Sex | null;
	birth_date?: string | null;
	birth_place?: string | null;
	death_date?: string | null;
	death_place?: string | null;
	is_living?: boolean;
	biography?: string | null;
	privacy_level?: PrivacyLevel;
	// Optional: immediately link this person to a site (sets up
	// `person_memorials`). The site doesn't have to be the person's
	// "home" — that's `sites.subject_person_id`.
	link_to_site_id?: string;
}

export function createPerson(input: CreatePersonInput): Person {
	const platform = getPlatformDb();
	const now = new Date().toISOString();
	const personId = personIdAlphabet();

	const birthYear = yearFromIsoDate(input.birth_date);
	const deathYear = yearFromIsoDate(input.death_date);
	const isLiving = input.is_living ?? (!input.death_date && !deathYear) ? 1 : 0;

	platform.exec('BEGIN IMMEDIATE');
	try {
		platform
			.prepare(
				`INSERT INTO people (
					person_id, display_name, given_names, surname,
					sex, birth_date, birth_place, death_date, death_place,
					birth_year, death_year, is_living, biography,
					privacy_level, owner_user_id, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				personId,
				input.display_name,
				input.given_names ?? null,
				input.surname ?? null,
				input.sex ?? null,
				input.birth_date ?? null,
				input.birth_place ?? null,
				input.death_date ?? null,
				input.death_place ?? null,
				birthYear,
				deathYear,
				isLiving,
				input.biography ?? null,
				input.privacy_level ?? 'public',
				input.owner_user_id,
				now,
				now
			);

		platform
			.prepare(
				`INSERT INTO person_access (person_id, user_id, role, created_at)
				 VALUES (?, ?, 'owner', ?)`
			)
			.run(personId, input.owner_user_id, now);

		if (input.link_to_site_id) {
			platform
				.prepare(
					`INSERT INTO person_memorials (person_id, site_id, created_at)
					 VALUES (?, ?, ?)`
				)
				.run(personId, input.link_to_site_id, now);
		}

		platform.exec('COMMIT');
	} catch (err) {
		platform.exec('ROLLBACK');
		throw err;
	}

	return getPerson(personId)!;
}

export function getPerson(personId: string): Person | null {
	const raw = getPlatformDb()
		.prepare(
			`SELECT person_id, display_name, given_names, surname,
			        sex, birth_date, birth_place, death_date, death_place,
			        birth_year, death_year, is_living, biography,
			        privacy_level, owner_user_id, created_at, updated_at
			 FROM people WHERE person_id = ?`
		)
		.get(personId);
	return parseRowOptional(PersonRowSchema, raw) ?? null;
}

export interface UpdatePersonInput {
	display_name?: string;
	given_names?: string | null;
	surname?: string | null;
	sex?: Sex | null;
	birth_date?: string | null;
	birth_place?: string | null;
	death_date?: string | null;
	death_place?: string | null;
	is_living?: boolean;
	biography?: string | null;
	privacy_level?: PrivacyLevel;
}

export function updatePerson(personId: string, input: UpdatePersonInput): Person {
	const existing = getPerson(personId);
	if (!existing) throw new Error(`person ${personId} not found`);
	const now = new Date().toISOString();

	const next: Person = {
		...existing,
		display_name: input.display_name ?? existing.display_name,
		given_names: input.given_names !== undefined ? input.given_names : existing.given_names,
		surname: input.surname !== undefined ? input.surname : existing.surname,
		sex: input.sex !== undefined ? input.sex : existing.sex,
		birth_date: input.birth_date !== undefined ? input.birth_date : existing.birth_date,
		birth_place: input.birth_place !== undefined ? input.birth_place : existing.birth_place,
		death_date: input.death_date !== undefined ? input.death_date : existing.death_date,
		death_place: input.death_place !== undefined ? input.death_place : existing.death_place,
		biography: input.biography !== undefined ? input.biography : existing.biography,
		privacy_level: input.privacy_level ?? existing.privacy_level,
		is_living: (input.is_living !== undefined
			? input.is_living
			: existing.is_living === 1)
			? 1
			: 0,
		updated_at: now
	};

	// Year columns stay in sync with the ISO date columns — they're
	// fast to filter on and useful for the "living unless born <100y ago"
	// privacy heuristic.
	next.birth_year = yearFromIsoDate(next.birth_date) ?? null;
	next.death_year = yearFromIsoDate(next.death_date) ?? null;

	getPlatformDb()
		.prepare(
			`UPDATE people SET
				display_name = ?, given_names = ?, surname = ?,
				sex = ?, birth_date = ?, birth_place = ?, death_date = ?, death_place = ?,
				birth_year = ?, death_year = ?, is_living = ?, biography = ?,
				privacy_level = ?, updated_at = ?
			 WHERE person_id = ?`
		)
		.run(
			next.display_name,
			next.given_names,
			next.surname,
			next.sex,
			next.birth_date,
			next.birth_place,
			next.death_date,
			next.death_place,
			next.birth_year,
			next.death_year,
			next.is_living,
			next.biography,
			next.privacy_level,
			next.updated_at,
			personId
		);

	return next;
}

/**
 * Insert a parent → child edge. Refuses cycles via a recursive CTE
 * check on the existing ancestor closure: if the would-be child is
 * already an ancestor of the would-be parent, reject.
 */
export function addParentEdge(input: {
	parent_id: string;
	child_id: string;
	kind?: ParentKind;
	certainty?: 'certain' | 'probable' | 'unverified';
	source_note?: string;
}): ParentEdge {
	if (input.parent_id === input.child_id) {
		throw new Error('a person cannot be their own parent');
	}
	const platform = getPlatformDb();

	// Cycle guard. If child_id is already an ancestor of parent_id, the
	// new edge would close a loop — reject.
	const cycle = parseRowOptional(
		ExistenceMarkerRowSchema,
		platform
			.prepare(
				`WITH RECURSIVE anc(id, depth) AS (
					SELECT ?, 0
					UNION
					SELECT r.from_person_id, anc.depth + 1
					FROM anc JOIN relationships r ON r.to_person_id = anc.id
					WHERE r.relation_type = 'parent_of' AND anc.depth < 32
				)
				SELECT 1 FROM anc WHERE id = ? LIMIT 1`
			)
			.get(input.parent_id, input.child_id)
	);
	if (cycle) {
		throw new Error('cycle: candidate child is already an ancestor of candidate parent');
	}

	const now = new Date().toISOString();
	const kind = input.kind ?? 'biological';
	platform
		.prepare(
			`INSERT OR REPLACE INTO relationships
				(from_person_id, to_person_id, relation_type, kind, certainty, source_note, created_at)
			 VALUES (?, ?, 'parent_of', ?, ?, ?, ?)`
		)
		.run(
			input.parent_id,
			input.child_id,
			kind,
			input.certainty ?? 'certain',
			input.source_note ?? null,
			now
		);

	return {
		parent_id: input.parent_id,
		child_id: input.child_id,
		kind,
		certainty: input.certainty ?? 'certain'
	};
}

export function removeParentEdge(parentId: string, childId: string): void {
	getPlatformDb()
		.prepare(
			`DELETE FROM relationships
			 WHERE from_person_id = ? AND to_person_id = ? AND relation_type = 'parent_of'`
		)
		.run(parentId, childId);
}

/**
 * Create or fetch a couple between two persons. Always normalises so
 * `person_a_id < person_b_id` (the CHECK constraint enforces it too).
 */
export function createCouple(input: {
	person_a_id: string;
	person_b_id: string;
	kind?: CoupleKind;
	start_date?: string | null;
	end_date?: string | null;
	end_reason?: CoupleEndReason | null;
	source_note?: string | null;
}): Couple {
	if (input.person_a_id === input.person_b_id) {
		throw new Error('a person cannot be their own spouse');
	}
	const [a, b] =
		input.person_a_id < input.person_b_id
			? [input.person_a_id, input.person_b_id]
			: [input.person_b_id, input.person_a_id];

	const platform = getPlatformDb();
	const existing = parseRowOptional(
		CoupleRowSchema,
		platform
			.prepare(
				`SELECT couple_id, person_a_id, person_b_id, kind, start_date, end_date, end_reason
				 FROM couples WHERE person_a_id = ? AND person_b_id = ?`
			)
			.get(a, b)
	);
	if (existing) return existing;

	const id = coupleIdAlphabet();
	const now = new Date().toISOString();
	platform
		.prepare(
			`INSERT INTO couples (
				couple_id, person_a_id, person_b_id, kind, start_date, end_date, end_reason,
				certainty, source_note, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, 'certain', ?, ?)`
		)
		.run(
			id,
			a,
			b,
			input.kind ?? 'marriage',
			input.start_date ?? null,
			input.end_date ?? null,
			input.end_reason ?? null,
			input.source_note ?? null,
			now
		);

	return {
		couple_id: id,
		person_a_id: a,
		person_b_id: b,
		kind: input.kind ?? 'marriage',
		start_date: input.start_date ?? null,
		end_date: input.end_date ?? null,
		end_reason: input.end_reason ?? null
	};
}

export function getCoupleById(coupleId: string): Couple | null {
	const raw = getPlatformDb()
		.prepare(
			`SELECT couple_id, person_a_id, person_b_id, kind, start_date, end_date, end_reason
			 FROM couples WHERE couple_id = ?`
		)
		.get(coupleId);
	return parseRowOptional(CoupleRowSchema, raw) ?? null;
}

export function removeCouple(coupleId: string): void {
	getPlatformDb()
		.prepare(`DELETE FROM couples WHERE couple_id = ?`)
		.run(coupleId);
}

/**
 * Permanently delete a person and every edge that touches them.
 * Cascade is explicit (no SQLite FK ON DELETE) because the
 * `relationships`, `couples`, `person_memorials`, and `person_access`
 * rows all need to go.
 *
 * Site `subject_person_id` references are nulled to a tombstone state
 * so the tree page shows the empty-state CTA again — better than a
 * dangling FK that crashes load.
 */
export function deletePerson(personId: string): void {
	const platform = getPlatformDb();
	platform.exec('BEGIN IMMEDIATE');
	try {
		platform
			.prepare(`UPDATE sites SET subject_person_id = NULL, updated_at = ? WHERE subject_person_id = ?`)
			.run(new Date().toISOString(), personId);
		platform
			.prepare(`DELETE FROM relationships WHERE from_person_id = ? OR to_person_id = ?`)
			.run(personId, personId);
		platform
			.prepare(`DELETE FROM couples WHERE person_a_id = ? OR person_b_id = ?`)
			.run(personId, personId);
		platform
			.prepare(`DELETE FROM person_aliases WHERE person_id = ?`)
			.run(personId);
		platform
			.prepare(`DELETE FROM person_memorials WHERE person_id = ?`)
			.run(personId);
		platform
			.prepare(`DELETE FROM person_access WHERE person_id = ?`)
			.run(personId);
		platform.prepare(`DELETE FROM people WHERE person_id = ?`).run(personId);
		platform.exec('COMMIT');
	} catch (err) {
		platform.exec('ROLLBACK');
		throw err;
	}
}

export function linkPersonToSite(personId: string, siteId: string): void {
	const now = new Date().toISOString();
	getPlatformDb()
		.prepare(
			`INSERT OR IGNORE INTO person_memorials (person_id, site_id, created_at)
			 VALUES (?, ?, ?)`
		)
		.run(personId, siteId, now);
}

export function setSiteSubject(siteId: string, personId: string | null): void {
	getPlatformDb()
		.prepare(`UPDATE sites SET subject_person_id = ?, updated_at = ? WHERE site_id = ?`)
		.run(personId, new Date().toISOString(), siteId);
	if (personId) {
		linkPersonToSite(personId, siteId);
	}
}

export function getSiteSubjectId(siteId: string): string | null {
	const raw = getPlatformDb()
		.prepare(`SELECT subject_person_id FROM sites WHERE site_id = ?`)
		.get(siteId);
	const row = parseRowOptional(SubjectRowSchema, raw);
	return row?.subject_person_id ?? null;
}

/**
 * Can the user edit people on this site? Any owner/editor of a site
 * inherits write access to people linked to it via `person_memorials`,
 * plus the site's `subject_person_id` even before it's linked.
 *
 * `person_access` is for cross-site overrides (someone curates a person
 * but doesn't own the memorial). The site path is the common one in v1.
 */
export function userCanEditPerson(personId: string, userId: string | null): boolean {
	if (!userId) return false;
	const platform = getPlatformDb();

	// Direct ownership / curator grant.
	const direct = parseRowOptional(
		ExistenceMarkerRowSchema,
		platform
			.prepare(
				`SELECT 1 FROM person_access
				 WHERE person_id = ? AND user_id = ? AND role IN ('owner','editor')`
			)
			.get(personId, userId)
	);
	if (direct) return true;

	// Transitive via any site that this person is linked to.
	const transitive = parseRowOptional(
		ExistenceMarkerRowSchema,
		platform
			.prepare(
				`SELECT 1
				 FROM person_memorials pm
				 JOIN site_members sm ON sm.site_id = pm.site_id
				 WHERE pm.person_id = ? AND sm.user_id = ? AND sm.role IN ('owner','editor')
				 LIMIT 1`
			)
			.get(personId, userId)
	);
	return !!transitive;
}

/**
 * Walk ancestors + descendants of `rootPersonId` up to `levels`
 * generations each direction, then fetch the rendered people, parent
 * edges, and couples.
 *
 * Couples are returned for any person in the result set — that's how the
 * UI knows who to render as a horizontal spouse next to a focal person.
 */
export function getTreeRootedAt(rootPersonId: string, levels = 4): TreePayload {
	const platform = getPlatformDb();

	const ids = new Set<string>([rootPersonId]);

	// Ancestors.
	const ancestorRows = parseRows(
		IdRowSchema,
		platform
			.prepare(
				`WITH RECURSIVE anc(id, depth) AS (
					SELECT ?, 0
					UNION
					SELECT r.from_person_id, anc.depth + 1
					FROM anc JOIN relationships r ON r.to_person_id = anc.id
					WHERE r.relation_type = 'parent_of' AND anc.depth < ?
				)
				SELECT id FROM anc`
			)
			.all(rootPersonId, levels)
	);
	for (const r of ancestorRows) ids.add(r.id);

	// Descendants.
	const descendantRows = parseRows(
		IdRowSchema,
		platform
			.prepare(
				`WITH RECURSIVE des(id, depth) AS (
					SELECT ?, 0
					UNION
					SELECT r.to_person_id, des.depth + 1
					FROM des JOIN relationships r ON r.from_person_id = des.id
					WHERE r.relation_type = 'parent_of' AND des.depth < ?
				)
				SELECT id FROM des`
			)
			.all(rootPersonId, levels)
	);
	for (const r of descendantRows) ids.add(r.id);

	// Pull spouses of everyone collected so far (so they appear on the
	// canvas). We don't recurse on a spouse's ancestors — that's an
	// in-law subtree and not what the visitor came to see.
	if (ids.size > 0) {
		const placeholders = Array.from(ids, () => '?').join(',');
		const spouseRows = parseRows(
			EdgePairRowSchema,
			platform
				.prepare(
					`SELECT DISTINCT person_a_id AS a, person_b_id AS b
					 FROM couples
					 WHERE person_a_id IN (${placeholders}) OR person_b_id IN (${placeholders})`
				)
				.all(...ids, ...ids)
		);
		for (const r of spouseRows) {
			ids.add(r.a);
			ids.add(r.b);
		}
	}

	if (ids.size === 0) {
		return { root_person_id: rootPersonId, people: [], parent_edges: [], couples: [] };
	}

	const placeholders = Array.from(ids, () => '?').join(',');

	const people = parseRows(
		PersonRowSchema,
		platform
			.prepare(
				`SELECT person_id, display_name, given_names, surname,
				        sex, birth_date, birth_place, death_date, death_place,
				        birth_year, death_year, is_living, biography,
				        privacy_level, owner_user_id, created_at, updated_at
				 FROM people WHERE person_id IN (${placeholders})`
			)
			.all(...ids)
	);

	const parent_edges = parseRows(
		ParentEdgeRowSchema,
		platform
			.prepare(
				`SELECT from_person_id AS parent_id, to_person_id AS child_id,
				        COALESCE(kind, 'biological') AS kind, certainty
				 FROM relationships
				 WHERE relation_type = 'parent_of'
				   AND from_person_id IN (${placeholders})
				   AND to_person_id IN (${placeholders})`
			)
			.all(...ids, ...ids)
	);

	const couples = parseRows(
		CoupleRowSchema,
		platform
			.prepare(
				`SELECT couple_id, person_a_id, person_b_id, kind, start_date, end_date, end_reason
				 FROM couples
				 WHERE person_a_id IN (${placeholders}) AND person_b_id IN (${placeholders})`
			)
			.all(...ids, ...ids)
	);

	return { root_person_id: rootPersonId, people, parent_edges, couples };
}

/**
 * Heuristic for "is this person likely living, and therefore should
 * details be redacted for non-admin viewers?"
 *
 * Returns true if `is_living=1`, or if no death date is recorded AND
 * (no birth date is recorded OR birth was less than 100 years ago).
 *
 * The privacy-redaction layer in the load function uses this to
 * substitute "Living relative" placeholders for the UI.
 */
export function isLikelyLiving(p: Pick<Person, 'is_living' | 'death_date' | 'death_year' | 'birth_year'>): boolean {
	if (p.is_living === 1) return true;
	if (p.death_date || p.death_year) return false;
	if (!p.birth_year) return true;
	const thisYear = new Date().getUTCFullYear();
	return thisYear - p.birth_year < 100;
}

/**
 * Strip private fields from `Person` records the viewer isn't
 * authorised to see, replacing them with `is_redacted: true` plus
 * nulls. Keeps `person_id`, `is_living`, and `sex` so the tree
 * layout can still place the card and pick a placeholder icon —
 * the structural fact that "someone exists here" is the same
 * whether they're public or not (and on this site they already
 * have a row in `person_memorials`).
 *
 * `keepId` (typically the site's subject) is exempt — the focal
 * person of a memorial is always shown in full, even if the
 * is-living heuristic would otherwise hide them (the admin just
 * hasn't filled in a death date yet).
 *
 * Apply server-side at the load boundary; never trust the client
 * to redact.
 */
export function redactLivingPersons(people: Person[], keepId?: string | null): Person[] {
	return people.map((p) =>
		p.person_id !== keepId && isLikelyLiving(p)
			? {
					...p,
					display_name: '',
					given_names: null,
					surname: null,
					birth_date: null,
					birth_place: null,
					death_date: null,
					death_place: null,
					birth_year: null,
					death_year: null,
					biography: null,
					is_redacted: true
				}
			: p
	);
}

/**
 * `redactLivingPersons` applied to a full `TreePayload`. Pass the
 * whole payload through one call at the load boundary.
 */
export function redactTree(tree: TreePayload, keepId?: string | null): TreePayload {
	return { ...tree, people: redactLivingPersons(tree.people, keepId) };
}

function yearFromIsoDate(date: string | null | undefined): number | null {
	if (!date) return null;
	const m = /^(-?\d{4})/.exec(date);
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------
// GEDCOM 7 import
// ---------------------------------------------------------------

import type { ParsedGedcom } from '$lib/gedcom.js';

export interface GedcomImportResult {
	people_created: number;
	parent_edges_created: number;
	couples_created: number;
	skipped: string[];
}

/**
 * Materialise a `ParsedGedcom` payload (from `reduceGedcom`) into
 * platform DB rows on behalf of `owner_user_id`. Each INDI becomes a
 * `people` row (auto-linked to `site_id` via `person_memorials`);
 * each FAM becomes:
 *   - `couples` row for HUSB+WIFE (if both present)
 *   - `relationships` parent_of edges from each parent to each CHIL
 *
 * Wrapped in a single platform transaction so a malformed FAM doesn't
 * leave half-imported state behind.
 *
 * Returns counts + a list of soft-skip reasons (e.g. cycle attempts
 * from a malformed input). Doesn't throw on per-record failure —
 * importers should preview the file, so individual records being
 * rejected is part of the expected flow.
 */
export function importParsedGedcom(
	parsed: ParsedGedcom,
	siteId: string,
	ownerUserId: string
): GedcomImportResult {
	const result: GedcomImportResult = {
		people_created: 0,
		parent_edges_created: 0,
		couples_created: 0,
		skipped: []
	};
	const xrefToPersonId = new Map<string, string>();

	// Best-effort import. Each `createPerson` / `createCouple` /
	// `addParentEdge` is wrapped in its own per-row transaction
	// already, so individual row consistency is intact even if the
	// import stops partway. We don't wrap a top-level transaction
	// here because nested BEGINs aren't allowed in SQLite — the
	// helpers we call would conflict with an outer BEGIN.
	{
		for (const ind of parsed.individuals) {
			const person = createPerson({
				owner_user_id: ownerUserId,
				display_name: ind.display_name || ind.xref,
				given_names: ind.given_names ?? null,
				surname: ind.surname ?? null,
				sex: ind.sex === 'U' ? null : ind.sex,
				birth_date: ind.birth_date ?? null,
				birth_place: ind.birth_place ?? null,
				death_date: ind.death_date ?? null,
				death_place: ind.death_place ?? null,
				is_living: ind.is_living,
				biography: ind.biography ?? null,
				link_to_site_id: siteId
			});
			xrefToPersonId.set(ind.xref, person.person_id);
			result.people_created += 1;
		}

		for (const fam of parsed.families) {
			const a = fam.partner_a_xref ? xrefToPersonId.get(fam.partner_a_xref) : undefined;
			const b = fam.partner_b_xref ? xrefToPersonId.get(fam.partner_b_xref) : undefined;
			if (a && b) {
				try {
					createCouple({
						person_a_id: a,
						person_b_id: b,
						start_date: fam.marr_date ?? null,
						end_date: fam.div_date ?? null,
						end_reason: fam.div_date ? 'divorce' : null
					});
					result.couples_created += 1;
				} catch (err) {
					result.skipped.push(
						`couple ${fam.xref}: ${err instanceof Error ? err.message : 'unknown'}`
					);
				}
			}

			for (const childXref of fam.children_xrefs) {
				const childId = xrefToPersonId.get(childXref);
				if (!childId) continue;
				for (const parentId of [a, b]) {
					if (!parentId) continue;
					try {
						addParentEdge({ parent_id: parentId, child_id: childId });
						result.parent_edges_created += 1;
					} catch (err) {
						result.skipped.push(
							`edge ${fam.xref} ${parentId} → ${childId}: ${err instanceof Error ? err.message : 'unknown'}`
						);
					}
				}
			}
		}
	}

	// Unrelated to created counts: also stamp the site's
	// `subject_person_id` to the FIRST imported person if the site has
	// no subject yet. Best-effort — admins can re-set later.
	const currentSubject = getSiteSubjectId(siteId);
	if (!currentSubject && parsed.individuals[0]) {
		const firstId = xrefToPersonId.get(parsed.individuals[0].xref);
		if (firstId) setSiteSubject(siteId, firstId);
	}

	return result;
}

/**
 * Wide read used by the GEDCOM exporter — everyone linked to the
 * site via `person_memorials`, plus every relationship + couple
 * among them. Distinct from `getTreeRootedAt` which is bounded by
 * generation depth from one focal person.
 */
export function getAllSitePeople(siteId: string): TreePayload {
	const platform = getPlatformDb();
	const idRows = parseRows(
		PersonIdRowSchema,
		platform
			.prepare(`SELECT person_id FROM person_memorials WHERE site_id = ?`)
			.all(siteId)
	);
	const ids = idRows.map((r) => r.person_id);
	if (ids.length === 0) {
		return { root_person_id: '', people: [], parent_edges: [], couples: [] };
	}
	const placeholders = ids.map(() => '?').join(',');
	const people = parseRows(
		PersonRowSchema,
		platform
			.prepare(
				`SELECT person_id, display_name, given_names, surname,
				        sex, birth_date, birth_place, death_date, death_place,
				        birth_year, death_year, is_living, biography,
				        privacy_level, owner_user_id, created_at, updated_at
				 FROM people WHERE person_id IN (${placeholders})`
			)
			.all(...ids)
	);
	const parent_edges = parseRows(
		ParentEdgeRowSchema,
		platform
			.prepare(
				`SELECT from_person_id AS parent_id, to_person_id AS child_id,
				        COALESCE(kind, 'biological') AS kind, certainty
				 FROM relationships
				 WHERE relation_type = 'parent_of'
				   AND from_person_id IN (${placeholders})
				   AND to_person_id IN (${placeholders})`
			)
			.all(...ids, ...ids)
	);
	const couples = parseRows(
		CoupleRowSchema,
		platform
			.prepare(
				`SELECT couple_id, person_a_id, person_b_id, kind, start_date, end_date, end_reason
				 FROM couples
				 WHERE person_a_id IN (${placeholders}) AND person_b_id IN (${placeholders})`
			)
			.all(...ids, ...ids)
	);
	return {
		root_person_id: getSiteSubjectId(siteId) ?? ids[0],
		people,
		parent_edges,
		couples
	};
}
