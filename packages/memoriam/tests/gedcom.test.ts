import { describe, it, expect } from 'vitest';
import {
	parseGedcom,
	reduceGedcom,
	gedcomDateToIso,
	isoDateToGedcom,
	exportTreeAsGedcom
} from '$lib/gedcom.js';

const SAMPLE = `0 HEAD
1 GEDC
2 VERS 7.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Edith /Holloway/
2 GIVN Edith
2 SURN Holloway
1 SEX F
1 BIRT
2 DATE 12 APR 1925
2 PLAC Łódź
1 DEAT
2 DATE 3 NOV 2018
2 PLAC Warsaw
1 FAMC @F1@
1 FAMS @F2@
1 NOTE Grandma. Loved gardening.
2 CONT Made the best pierogi.
0 @I2@ INDI
1 NAME Marek /Holloway/
1 SEX M
1 BIRT
2 DATE 1898
0 @I3@ INDI
1 NAME Anna /Kowalska/
1 SEX F
1 BIRT
2 DATE ABT 1900
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 MARR
2 DATE 1923
0 TRLR
`;

describe('gedcom parser', () => {
	it('parses level / xref / tag / value', () => {
		const records = parseGedcom(SAMPLE);
		const xrefs = records.filter((r) => r.xref).map((r) => `${r.tag}:${r.xref}`);
		expect(xrefs).toEqual(['INDI:I1', 'INDI:I2', 'INDI:I3', 'FAM:F1']);
	});

	it('nests children by level', () => {
		const records = parseGedcom(SAMPLE);
		const head = records[0];
		expect(head.tag).toBe('HEAD');
		const gedc = head.children.find((c) => c.tag === 'GEDC');
		const vers = gedc?.children.find((c) => c.tag === 'VERS');
		expect(vers?.value).toBe('7.0');
	});

	it('folds CONT into the parent value', () => {
		const records = parseGedcom(SAMPLE);
		const edith = records.find((r) => r.xref === 'I1');
		const note = edith?.children.find((c) => c.tag === 'NOTE');
		expect(note?.value).toBe('Grandma. Loved gardening.\nMade the best pierogi.');
	});

	it('reduces to individuals + families with the expected shape', () => {
		const { individuals, families } = reduceGedcom(parseGedcom(SAMPLE));
		expect(individuals).toHaveLength(3);
		const edith = individuals.find((i) => i.xref === 'I1')!;
		expect(edith.display_name).toBe('Edith Holloway');
		expect(edith.given_names).toBe('Edith');
		expect(edith.surname).toBe('Holloway');
		expect(edith.sex).toBe('F');
		expect(edith.birth_date).toBe('1925-04-12');
		expect(edith.birth_place).toBe('Łódź');
		expect(edith.death_date).toBe('2018-11-03');
		expect(edith.is_living).toBe(false);

		const marek = individuals.find((i) => i.xref === 'I2')!;
		expect(marek.is_living).toBe(true);
		expect(marek.birth_date).toBe('1898');

		expect(families).toHaveLength(1);
		const f1 = families[0];
		expect(f1.xref).toBe('F1');
		expect(f1.partner_a_xref).toBe('I2');
		expect(f1.partner_b_xref).toBe('I3');
		expect(f1.children_xrefs).toEqual(['I1']);
		expect(f1.marr_date).toBe('1923');
	});

	it('parses GEDCOM date variants', () => {
		expect(gedcomDateToIso('12 APR 1925')).toBe('1925-04-12');
		expect(gedcomDateToIso('APR 1925')).toBe('1925-04');
		expect(gedcomDateToIso('1925')).toBe('1925');
		// Modifiers get stripped; we keep the date and lose the qualifier.
		expect(gedcomDateToIso('ABT 1925')).toBe('1925');
		expect(gedcomDateToIso('BEF 12 APR 1925')).toBe('1925-04-12');
		expect(gedcomDateToIso('BET 1925 AND 1930')).toBe('1925');
		// Garbage returns null — the importer treats it as unknown.
		expect(gedcomDateToIso('whenever')).toBeNull();
		expect(gedcomDateToIso('')).toBeNull();
		expect(gedcomDateToIso(null)).toBeNull();
	});

	it('inverts ISO → GEDCOM for full / partial / year-only', () => {
		expect(isoDateToGedcom('1925-04-12')).toBe('12 APR 1925');
		expect(isoDateToGedcom('1925-04')).toBe('APR 1925');
		expect(isoDateToGedcom('1925')).toBe('1925');
		expect(isoDateToGedcom('not a date')).toBeNull();
		expect(isoDateToGedcom(null)).toBeNull();
	});

	it('exporter round-trips a small tree', () => {
		const text = exportTreeAsGedcom({
			source_name: 'memoriam',
			people: [
				{
					person_id: 'p1',
					display_name: 'Edith Holloway',
					given_names: 'Edith',
					surname: 'Holloway',
					sex: 'F',
					birth_date: '1925-04-12',
					birth_place: 'Łódź',
					death_date: '2018-11-03',
					death_place: 'Warsaw',
					biography: 'Loved gardening.\nMade the best pierogi.'
				},
				{
					person_id: 'p2',
					display_name: 'Marek Holloway',
					given_names: 'Marek',
					surname: 'Holloway',
					sex: 'M',
					birth_date: '1898',
					birth_place: null,
					death_date: null,
					death_place: null,
					biography: null
				}
			],
			parent_edges: [{ parent_id: 'p2', child_id: 'p1' }],
			couples: []
		});

		// Spot-check the salient lines. Full output ordering is stable
		// because we walk arrays in order.
		expect(text).toContain('0 HEAD');
		expect(text).toContain('2 VERS 7.0');
		expect(text).toContain('1 SOUR memoriam');
		expect(text).toContain('1 NAME Edith /Holloway/');
		expect(text).toContain('1 SEX F');
		expect(text).toContain('2 DATE 12 APR 1925');
		expect(text).toContain('2 PLAC Łódź');
		expect(text).toContain('2 DATE 3 NOV 2018');
		// Multi-line NOTE: first line as value, subsequent as CONT.
		expect(text).toContain('1 NOTE Loved gardening.');
		expect(text).toContain('2 CONT Made the best pierogi.');
		// Synthetic FAM gets created for the parent-only edge.
		expect(text).toContain('0 @F1@ FAM');
		expect(text).toContain('1 HUSB @I2@');
		expect(text).toContain('1 CHIL @I1@');
		expect(text).toContain('0 TRLR');

		// And the export can be parsed back into our model. People +
		// FAMs round-trip; the FAM groups Marek as parent of Edith.
		const { individuals, families } = reduceGedcom(parseGedcom(text));
		expect(individuals.map((i) => i.display_name).sort()).toEqual([
			'Edith Holloway',
			'Marek Holloway'
		]);
		expect(families).toHaveLength(1);
		expect(families[0].children_xrefs).toEqual(['I1']);
		expect(families[0].partner_a_xref).toBe('I2');
	});

	it('ignores unknown tags + malformed lines without crashing', () => {
		const messy = `0 HEAD
1 GEDC
2 VERS 7.0
   not a valid line
0 @I1@ INDI
1 NAME Alone
1 _CUSTOM something we don't care about
0 TRLR
`;
		const { individuals, families } = reduceGedcom(parseGedcom(messy));
		expect(individuals).toHaveLength(1);
		expect(individuals[0].display_name).toBe('Alone');
		expect(families).toHaveLength(0);
	});
});
