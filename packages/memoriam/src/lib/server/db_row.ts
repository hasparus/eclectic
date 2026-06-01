/**
 * Row-validation helpers for SQLite reads.
 *
 * `node:sqlite` returns row values as `SQLOutputValue` (the union of
 * `string | number | bigint | null | Uint8Array`) — that's an
 * untyped-but-real boundary. Casts like `as { ... }` lie about
 * what arrived: a renamed column, a NULL where the column is
 * NOT NULL after a migration, a wrong join — all sail through.
 *
 * `parseRow` / `parseRowOptional` / `parseRows` run the row through
 * an arktype schema and throw at the boundary so the caller sees
 * a structured shape (and a real error path) instead of an
 * `undefined.foo` crash three frames deep.
 */

import { type } from 'arktype';

/**
 * Validate a row that the caller knows must exist. Throws on
 * shape mismatch and on `undefined` (no row).
 */
export function parseRow<S extends type.Any>(schema: S, row: unknown): S['infer'] {
	if (row === undefined || row === null) {
		throw new Error(
			`parseRow: expected a row, got ${row === undefined ? 'undefined' : 'null'}. ` +
				`Use parseRowOptional if absence is legal.`
		);
	}
	const result = schema(row);
	if (result instanceof type.errors) {
		throw new Error(`parseRow: row failed validation: ${result.summary}`);
	}
	return result as S['infer'];
}

/**
 * Validate a row that may not exist. Returns the parsed row, or
 * `undefined` if the query found no row. Throws on shape mismatch
 * — a row that's present but malformed is still a bug.
 */
export function parseRowOptional<S extends type.Any>(
	schema: S,
	row: unknown
): S['infer'] | undefined {
	if (row === undefined || row === null) return undefined;
	const result = schema(row);
	if (result instanceof type.errors) {
		throw new Error(`parseRowOptional: row failed validation: ${result.summary}`);
	}
	return result as S['infer'];
}

/**
 * Validate every row in an array. The input is `unknown` because
 * `prepare(sql).all(...)` returns `unknown[]` from `node:sqlite`.
 */
export function parseRows<S extends type.Any>(schema: S, rows: unknown): S['infer'][] {
	if (!Array.isArray(rows)) {
		throw new Error(`parseRows: expected an array, got ${typeof rows}`);
	}
	const arrayOf = schema.array();
	const result = arrayOf(rows);
	if (result instanceof type.errors) {
		throw new Error(`parseRows: rows failed validation: ${result.summary}`);
	}
	return result as S['infer'][];
}
