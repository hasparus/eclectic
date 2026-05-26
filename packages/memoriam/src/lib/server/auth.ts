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
