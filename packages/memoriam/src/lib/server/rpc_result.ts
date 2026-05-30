import type { Result } from 'neverthrow';
import type { AppError } from '$lib/server/app_error.js';

/**
 * Wire shape for remote functions: `{ ok: true } & T` on success,
 * `{ ok: false } & AppError` on failure. Kept as a discriminated union
 * (not a `Result` instance) because neverthrow's `Result` classes lose
 * their methods over JSON serialisation; the union travels intact.
 *
 * Server handlers compose with `Result<T, AppError>` via neverthrow,
 * then convert at the boundary with `rpcFromResult` below.
 */
export type RpcOk<T extends object> = { ok: true } & T;
export type RpcErr = { ok: false } & AppError;
export type RpcResult<T extends object> = RpcOk<T> | RpcErr;

/**
 * Boundary adapter: `Result<T, AppError>` → wire-friendly discriminated
 * union. T is intersected (spread) into the success branch so callers
 * access fields directly (`result.person`) — matches the existing
 * `{ ok: true; person }` shape.
 */
export function rpcFromResult<T extends object>(r: Result<T, AppError>): RpcResult<T> {
	return r.match<RpcResult<T>>(
		(data) => ({ ok: true, ...data }),
		(e) => ({ ok: false, code: e.code, message: e.message })
	);
}
