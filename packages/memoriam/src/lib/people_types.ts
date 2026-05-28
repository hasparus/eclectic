// Shared person / relationship types. Lives outside $lib/server so
// client-side code (the tree layout, Svelte components) can import them.
// The server module re-exports these — never type-import from
// `$lib/server/people` from any non-server file.

export type Sex = 'M' | 'F' | 'X' | 'U';
export type PrivacyLevel = 'public' | 'members' | 'private';
export type ParentKind = 'biological' | 'adoptive' | 'foster' | 'step' | 'unknown';
export type CoupleKind = 'marriage' | 'partnership' | 'engagement' | 'other';
export type CoupleEndReason = 'divorce' | 'death' | 'annulment' | 'separation';

export interface Person {
	person_id: string;
	display_name: string;
	given_names: string | null;
	surname: string | null;
	sex: Sex | null;
	birth_date: string | null;
	birth_place: string | null;
	death_date: string | null;
	death_place: string | null;
	birth_year: number | null;
	death_year: number | null;
	is_living: 0 | 1;
	biography: string | null;
	privacy_level: PrivacyLevel;
	owner_user_id: string;
	created_at: string;
	updated_at: string;
}

export interface ParentEdge {
	parent_id: string;
	child_id: string;
	kind: ParentKind;
	certainty: 'certain' | 'probable' | 'unverified';
}

export interface Couple {
	couple_id: string;
	person_a_id: string;
	person_b_id: string;
	kind: CoupleKind;
	start_date: string | null;
	end_date: string | null;
	end_reason: CoupleEndReason | null;
}

export interface TreePayload {
	root_person_id: string;
	people: Person[];
	parent_edges: ParentEdge[];
	couples: Couple[];
}
