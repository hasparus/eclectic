/**
 * App-level error shape. Carried over the wire in the `{ ok: false }`
 * branch of remote function returns, and also the `E` parameter for any
 * `Result<T, AppError>` neverthrow chains we build server-side.
 *
 * `code` is a short stable token (snake_case) used by callers to drive
 * UI branches; `message` is the human-readable text. Both come from a
 * single source — `errOf(code, message)` — so the wire serialisation
 * matches the in-memory shape exactly. Don't add fields here without
 * also updating every remote handler's `.match` boundary.
 */
export interface AppError {
	code: string;
	message: string;
}

/** Construct an AppError. Keep callers terse. */
export function errOf(code: string, message: string): AppError {
	return { code, message };
}

/**
 * Coerce a thrown value into an AppError. Internal helper for the
 * remote-handler boundary where we catch unknowns.
 */
export function fromUnknown(code: string, err: unknown, fallback: string): AppError {
	return { code, message: err instanceof Error ? err.message : fallback };
}
