import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality check for short secrets (tokens). Pads the
 * shorter input so the comparison time is independent of length.
 */
export function constantTimeEqual(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, 'utf8');
	const bBuf = Buffer.from(b, 'utf8');
	const len = Math.max(aBuf.length, bBuf.length);
	const aPadded = Buffer.alloc(len);
	const bPadded = Buffer.alloc(len);
	aBuf.copy(aPadded);
	bBuf.copy(bPadded);
	const equalBytes = timingSafeEqual(aPadded, bPadded);
	return equalBytes && aBuf.length === bBuf.length;
}

/**
 * Throw if the request is not an authenticated editor of the current
 * site. `locals.isAdmin` is set by hooks.server.js based on the user's
 * membership role on the resolved site.
 */
export function requireAdminSession(locals: { isAdmin?: boolean }): true {
	if (!locals.isAdmin) {
		throw new Error('Unauthorized');
	}
	return true;
}
