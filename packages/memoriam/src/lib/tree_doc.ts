/**
 * Shape of the per-site Automerge document holding the family-tree
 * editing state. Lives outside `$lib/server/` so both server and
 * client can type-import — the doc travels over WebSocket sync, so
 * both ends operate on it.
 *
 * The doc IS the multiplayer source of truth for live edits.
 * SQLite stays as the durable / queryable projection (GEDCOM
 * export, redaction joins, ACL lookups, etc.) — the server
 * re-projects Automerge changes into SQLite via a patch listener.
 *
 * Keys + nested fields are all CRDT-friendly: people are an object
 * keyed by person_id (so concurrent inserts of different keys never
 * collide), `parent_edges` is an array of structurally-keyed
 * records (cycle prevention is the server's job, the doc tolerates
 * eventual consistency), and `couples` is keyed by couple_id.
 *
 * Fields outside this doc — `birth_year`, `death_year`,
 * `is_redacted`, `privacy_level`, `owner_user_id`,
 * `created_at` / `updated_at` — stay server-derived; they're never
 * written from the client.
 */

import type { Sex, ParentKind, CoupleKind, CoupleEndReason } from '$lib/people_types.js';

export interface TreeDocPerson {
	person_id: string;
	display_name: string;
	given_names: string | null;
	surname: string | null;
	sex: Sex | null;
	birth_date: string | null;
	birth_place: string | null;
	death_date: string | null;
	death_place: string | null;
	biography: string | null;
	is_living: boolean;
}

export interface TreeDocParentEdge {
	parent_id: string;
	child_id: string;
	kind: ParentKind;
}

export interface TreeDocCouple {
	couple_id: string;
	person_a_id: string;
	person_b_id: string;
	kind: CoupleKind;
	start_date: string | null;
	end_date: string | null;
	end_reason: CoupleEndReason | null;
}

export interface TreeDoc {
	site_id: string;
	subject_person_id: string | null;
	people: Record<string, TreeDocPerson>;
	parent_edges: TreeDocParentEdge[];
	couples: Record<string, TreeDocCouple>;
}
