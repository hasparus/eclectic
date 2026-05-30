/**
 * Minimal GEDCOM 7 parser + reducer. Handles the subset memoriam
 * needs for import: `INDI` (with NAME / SEX / BIRT / DEAT / FAMC /
 * FAMS / NOTE) and `FAM` (with HUSB / WIFE / CHIL / MARR / DIV).
 * Everything else is ignored — sources, repositories, multimedia,
 * objects, submitters etc.
 *
 * The format is simple enough that a hand-rolled tokenizer wins over
 * a dependency: each line is `<level> [<@xref@>] <tag> [<value>]`,
 * and nesting is implied by `<level>` — children of a level-N record
 * are level-(N+1). `CONT` lines append a newline + value to the
 * parent. GEDCOM 7 dropped `CONC` so we don't handle it.
 *
 * Lives in `$lib/` (not `$lib/server/`) so the import wizard can
 * parse client-side and post the structured result to the server —
 * the parser has no `node:` imports.
 */

/** A node in the GEDCOM tree. Children are nested records. */
export interface GedcomNode {
	level: number;
	xref?: string;
	tag: string;
	value: string;
	children: GedcomNode[];
}

/** Parse a full GEDCOM file into a list of top-level records. */
export function parseGedcom(text: string): GedcomNode[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const root: GedcomNode[] = [];
	// Walking stack: top entry is the deepest open node. We pop until
	// the top is the parent of the incoming line.
	const stack: GedcomNode[] = [];

	for (const raw of lines) {
		if (!raw.trim()) continue;
		const m = /^(\d+)\s+(?:@([^@\s]+)@\s+)?([A-Z_][A-Z0-9_]*)(?:\s(.*))?$/.exec(raw);
		if (!m) continue;
		const [, levelStr, xref, tag, value = ''] = m;
		const level = Number(levelStr);

		while (stack.length && stack[stack.length - 1].level >= level) {
			stack.pop();
		}
		const parent = stack[stack.length - 1];

		// CONT folds a continuation line into its parent's value as a
		// new paragraph. Don't push it as its own child.
		if (tag === 'CONT' && parent) {
			parent.value = parent.value ? `${parent.value}\n${value}` : value;
			continue;
		}

		const node: GedcomNode = { level, xref, tag, value, children: [] };
		if (parent) parent.children.push(node);
		else root.push(node);
		stack.push(node);
	}

	return root;
}

// ---------------------------------------------------------------
// Reducer — collapses the raw tree into our app shape.
// ---------------------------------------------------------------

export type GedcomSex = 'M' | 'F' | 'X' | 'U';

export interface GedcomIndividual {
	xref: string;
	display_name: string;
	// Optional fields are nullable AND optional to match the arktype
	// schema in `api.remote.ts` — the parser produces explicit `null`,
	// but a JSON round-trip through `devalue` may drop or preserve
	// `undefined` depending on the producer.
	given_names?: string | null;
	surname?: string | null;
	sex: GedcomSex;
	birth_date?: string | null;
	birth_place?: string | null;
	death_date?: string | null;
	death_place?: string | null;
	biography?: string | null;
	is_living: boolean;
}

export interface GedcomFamily {
	xref: string;
	partner_a_xref?: string | null;
	partner_b_xref?: string | null;
	children_xrefs: string[];
	marr_date?: string | null;
	marr_place?: string | null;
	div_date?: string | null;
}

export interface ParsedGedcom {
	individuals: GedcomIndividual[];
	families: GedcomFamily[];
}

/** Walk parsed nodes → ParsedGedcom shape for the importer. */
export function reduceGedcom(records: GedcomNode[]): ParsedGedcom {
	const individuals: GedcomIndividual[] = [];
	const families: GedcomFamily[] = [];

	for (const r of records) {
		if (r.tag === 'INDI' && r.xref) individuals.push(reduceIndividual(r));
		else if (r.tag === 'FAM' && r.xref) families.push(reduceFamily(r));
	}

	return { individuals, families };
}

function child(node: GedcomNode | undefined, tag: string): GedcomNode | undefined {
	return node?.children.find((c) => c.tag === tag);
}

function children(node: GedcomNode | undefined, tag: string): GedcomNode[] {
	return node?.children.filter((c) => c.tag === tag) ?? [];
}

function reduceIndividual(r: GedcomNode): GedcomIndividual {
	const nameNode = child(r, 'NAME');
	const { display_name, given_names, surname } = parseGedcomName(nameNode);
	const sexNode = child(r, 'SEX');
	const sex: GedcomSex = parseSex(sexNode?.value);
	const birt = child(r, 'BIRT');
	const deat = child(r, 'DEAT');
	const noteNode = child(r, 'NOTE');

	return {
		xref: r.xref!,
		display_name,
		given_names,
		surname,
		sex,
		birth_date: gedcomDateToIso(child(birt, 'DATE')?.value),
		birth_place: child(birt, 'PLAC')?.value || null,
		death_date: gedcomDateToIso(child(deat, 'DATE')?.value),
		death_place: child(deat, 'PLAC')?.value || null,
		biography: noteNode?.value || null,
		// GEDCOM doesn't directly encode "still living". The absence of
		// DEAT + a recent BIRT is the conventional heuristic, but it's
		// the importer's job (or the redaction layer's). Default to
		// `!deat` — anyone with no death event is presumed living.
		is_living: !deat
	};
}

function reduceFamily(r: GedcomNode): GedcomFamily {
	// GEDCOM 7 keeps HUSB / WIFE tag names but they're semantically
	// just "partner 1 / partner 2" — read both, fall back to the
	// other slot if only one is set.
	const husb = child(r, 'HUSB')?.value;
	const wife = child(r, 'WIFE')?.value;
	const marr = child(r, 'MARR');
	const div = child(r, 'DIV');

	return {
		xref: r.xref!,
		partner_a_xref: stripXref(husb) ?? null,
		partner_b_xref: stripXref(wife) ?? null,
		children_xrefs: children(r, 'CHIL')
			.map((c) => stripXref(c.value))
			.filter((x): x is string => !!x),
		marr_date: gedcomDateToIso(child(marr, 'DATE')?.value),
		marr_place: child(marr, 'PLAC')?.value || null,
		div_date: gedcomDateToIso(child(div, 'DATE')?.value)
	};
}

function stripXref(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const m = /^@([^@\s]+)@$/.exec(value);
	return m ? m[1] : value;
}

/**
 * Split a GEDCOM `NAME` value like "Edith /Holloway/" into the
 * display, given, and surname parts. The /…/ delimiters mark the
 * surname; whitespace around them becomes the given names.
 *
 * If the slashes are missing we treat the whole string as the display
 * name (and leave given / surname null).
 */
function parseGedcomName(node: GedcomNode | undefined): {
	display_name: string;
	given_names: string | null;
	surname: string | null;
} {
	if (!node) return { display_name: '', given_names: null, surname: null };
	const value = node.value.trim();
	const m = /^([^/]*)\/([^/]*)\/(.*)$/.exec(value);
	if (m) {
		const given = m[1].trim() || null;
		const surname = m[2].trim() || null;
		const display = [given, surname].filter(Boolean).join(' ') || value;
		return { display_name: display, given_names: given, surname };
	}
	// `2 GIVN` / `2 SURN` subtags as a fallback (GEDCOM 7 lets you
	// drop the slash syntax in favour of structured subtags).
	const given = child(node, 'GIVN')?.value?.trim() || null;
	const surname = child(node, 'SURN')?.value?.trim() || null;
	const display = [given, surname].filter(Boolean).join(' ') || value || 'Unknown';
	return { display_name: display, given_names: given, surname };
}

function parseSex(value: string | undefined): GedcomSex {
	switch (value?.toUpperCase()) {
		case 'M':
			return 'M';
		case 'F':
			return 'F';
		case 'X':
			return 'X';
		default:
			return 'U';
	}
}

// ---------------------------------------------------------------
// Date conversion
// ---------------------------------------------------------------

const GEDCOM_MONTHS: Record<string, string> = {
	JAN: '01',
	FEB: '02',
	MAR: '03',
	APR: '04',
	MAY: '05',
	JUN: '06',
	JUL: '07',
	AUG: '08',
	SEP: '09',
	OCT: '10',
	NOV: '11',
	DEC: '12'
};

/**
 * Best-effort `<gedcom date>` → ISO (`YYYY` | `YYYY-MM` | `YYYY-MM-DD`)
 * conversion. Recognises:
 *
 *   "12 JUN 1925" → "1925-06-12"
 *   "JUN 1925"    → "1925-06"
 *   "1925"        → "1925"
 *   "ABT 1925" / "BEF 1925" / "AFT 1925" / "EST 1925"  → "1925"
 *   "BET 1925 AND 1930" → "1925"   (we lose the upper bound)
 *
 * Returns null for anything that can't be coerced (date phrases,
 * Hebrew calendars, etc.) — importer treats null dates as "unknown"
 * rather than failing the whole record.
 */
export function gedcomDateToIso(input: string | undefined | null): string | null {
	if (!input) return null;
	let s = input.trim().toUpperCase();
	// Strip approximation / range / phrase prefixes — we keep the
	// first useful date and drop the qualifier. v1 doesn't model
	// uncertainty, so this is the simplest harmless thing to do.
	s = s.replace(/^(ABT|BEF|AFT|EST|CAL|INT|FROM|TO|BET)\s+/, '');
	s = s.split(/\s+AND\s+/)[0];

	const dmy = /^(\d{1,2})\s+([A-Z]{3})\s+(-?\d{4})$/.exec(s);
	if (dmy) {
		const month = GEDCOM_MONTHS[dmy[2]];
		if (!month) return null;
		const day = dmy[1].padStart(2, '0');
		return `${dmy[3]}-${month}-${day}`;
	}
	const my = /^([A-Z]{3})\s+(-?\d{4})$/.exec(s);
	if (my) {
		const month = GEDCOM_MONTHS[my[1]];
		if (!month) return null;
		return `${my[2]}-${month}`;
	}
	const y = /^(-?\d{4})$/.exec(s);
	if (y) return y[1];
	return null;
}

// ---------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------

const ISO_MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC'
];

/**
 * ISO `1925-06-12` → GEDCOM `12 JUN 1925`. Returns null for invalid
 * input. Day-of-month coerces to integer (drops leading zero per the
 * GEDCOM 7 examples).
 */
export function isoDateToGedcom(input: string | null | undefined): string | null {
	if (!input) return null;
	const dmy = /^(-?\d{4})-(\d{2})-(\d{2})$/.exec(input);
	if (dmy) {
		const month = ISO_MONTHS[Number(dmy[2]) - 1];
		if (!month) return null;
		return `${Number(dmy[3])} ${month} ${dmy[1]}`;
	}
	const my = /^(-?\d{4})-(\d{2})$/.exec(input);
	if (my) {
		const month = ISO_MONTHS[Number(my[2]) - 1];
		if (!month) return null;
		return `${month} ${my[1]}`;
	}
	const y = /^(-?\d{4})$/.exec(input);
	if (y) return y[1];
	return null;
}

export interface ExportPerson {
	person_id: string;
	display_name: string;
	given_names: string | null;
	surname: string | null;
	sex: 'M' | 'F' | 'X' | 'U' | null;
	birth_date: string | null;
	birth_place: string | null;
	death_date: string | null;
	death_place: string | null;
	biography: string | null;
}

export interface ExportEdge {
	parent_id: string;
	child_id: string;
}

export interface ExportCouple {
	couple_id: string;
	person_a_id: string;
	person_b_id: string;
	start_date: string | null;
	end_date: string | null;
}

/**
 * Serialise a tree to GEDCOM 7 text. Each person becomes an INDI
 * record; each couple becomes a FAM record with HUSB / WIFE assigned
 * by `sex` (M→HUSB, F→WIFE, fall through to the order given).
 *
 * Children whose parent set doesn't match any explicit couple are
 * grouped into synthetic families — GEDCOM is family-record-centric,
 * there's no way to model a parent-child edge that doesn't go
 * through a FAM.
 */
export function exportTreeAsGedcom(payload: {
	people: ExportPerson[];
	parent_edges: ExportEdge[];
	couples: ExportCouple[];
	source_name?: string;
}): string {
	const peopleById = new Map(payload.people.map((p) => [p.person_id, p]));
	const personXref = new Map<string, string>();
	payload.people.forEach((p, i) => personXref.set(p.person_id, `I${i + 1}`));

	interface Fam {
		id: string;
		partner_a: string | null;
		partner_b: string | null;
		children: string[];
		marr_date: string | null;
	}
	const famByPartners = new Map<string, Fam>();
	const fams: Fam[] = [];
	const nextFamId = () => `F${fams.length + 1}`;

	// Seed FAMs from explicit couples.
	for (const c of payload.couples) {
		const key = [c.person_a_id, c.person_b_id].sort().join('|');
		const fam: Fam = {
			id: nextFamId(),
			partner_a: c.person_a_id,
			partner_b: c.person_b_id,
			children: [],
			marr_date: c.start_date
		};
		fams.push(fam);
		famByPartners.set(key, fam);
	}

	// Group parents by child, then place each into a FAM.
	const parentsByChild = new Map<string, string[]>();
	for (const e of payload.parent_edges) {
		const arr = parentsByChild.get(e.child_id) ?? [];
		arr.push(e.parent_id);
		parentsByChild.set(e.child_id, arr);
	}
	for (const [childId, parents] of parentsByChild) {
		const key = [...parents].sort().join('|');
		let fam = famByPartners.get(key);
		if (!fam) {
			fam = {
				id: nextFamId(),
				partner_a: parents[0] ?? null,
				partner_b: parents[1] ?? null,
				children: [],
				marr_date: null
			};
			fams.push(fam);
			famByPartners.set(key, fam);
		}
		fam.children.push(childId);
	}

	const lines: string[] = [];
	const w = (...l: string[]) => lines.push(...l);

	w('0 HEAD', '1 GEDC', '2 VERS 7.0', '1 CHAR UTF-8');
	if (payload.source_name) {
		w(`1 SOUR ${payload.source_name}`);
	}

	for (const p of payload.people) {
		const x = personXref.get(p.person_id)!;
		w(`0 @${x}@ INDI`);
		const name = p.display_name || [p.given_names, p.surname].filter(Boolean).join(' ');
		if (p.surname) w(`1 NAME ${p.given_names ?? ''} /${p.surname}/`.trim());
		else if (name) w(`1 NAME ${name}`);
		if (p.sex && p.sex !== 'U') w(`1 SEX ${p.sex}`);
		writeEvent(w, 'BIRT', p.birth_date, p.birth_place);
		writeEvent(w, 'DEAT', p.death_date, p.death_place);
		if (p.biography) writeMultiline(w, 1, 'NOTE', p.biography);
		// Pointers to families this person belongs to.
		for (const fam of fams) {
			if (fam.partner_a === p.person_id || fam.partner_b === p.person_id) {
				w(`1 FAMS @${fam.id}@`);
			}
			if (fam.children.includes(p.person_id)) {
				w(`1 FAMC @${fam.id}@`);
			}
		}
	}

	for (const fam of fams) {
		w(`0 @${fam.id}@ FAM`);
		if (fam.partner_a) {
			const a = peopleById.get(fam.partner_a);
			// Slot by sex when known; fall back to partner-a → HUSB.
			const tag = a?.sex === 'F' ? 'WIFE' : 'HUSB';
			w(`1 ${tag} @${personXref.get(fam.partner_a)}@`);
		}
		if (fam.partner_b) {
			const b = peopleById.get(fam.partner_b);
			const aTag = peopleById.get(fam.partner_a ?? '')?.sex === 'F' ? 'WIFE' : 'HUSB';
			const tag = b?.sex === 'F' ? 'WIFE' : b?.sex === 'M' ? 'HUSB' : aTag === 'HUSB' ? 'WIFE' : 'HUSB';
			w(`1 ${tag} @${personXref.get(fam.partner_b)}@`);
		}
		for (const c of fam.children) {
			w(`1 CHIL @${personXref.get(c)}@`);
		}
		if (fam.marr_date) {
			w('1 MARR');
			w(`2 DATE ${isoDateToGedcom(fam.marr_date) ?? fam.marr_date}`);
		}
	}

	w('0 TRLR');
	return lines.join('\n') + '\n';
}

function writeEvent(
	w: (...l: string[]) => void,
	tag: string,
	date: string | null,
	place: string | null
): void {
	if (!date && !place) return;
	w(`1 ${tag}`);
	if (date) w(`2 DATE ${isoDateToGedcom(date) ?? date}`);
	if (place) w(`2 PLAC ${place}`);
}

function writeMultiline(
	w: (...l: string[]) => void,
	level: number,
	tag: string,
	text: string
): void {
	const [first, ...rest] = text.split('\n');
	w(`${level} ${tag} ${first}`);
	for (const line of rest) {
		w(`${level + 1} CONT ${line}`);
	}
}
