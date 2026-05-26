import { redirect } from '@sveltejs/kit';
import { consumeMagicLink } from '$lib/server/magic_link.js';
import { createPlatformSession, setPlatformSessionCookie } from '$lib/server/sessions.js';
import { upsertUserByEmail } from '$lib/server/users.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		return { ok: false, reason: 'missing_token' as const };
	}

	const result = consumeMagicLink(token);
	if (!result.ok || !result.email) {
		return { ok: false, reason: result.reason ?? 'unknown' };
	}

	const user = upsertUserByEmail(result.email);
	const session = createPlatformSession(user.user_id);
	setPlatformSessionCookie(cookies, session.session_id);

	const next = url.searchParams.get('next');
	if (next && next.startsWith('/')) {
		throw redirect(303, next);
	}
	throw redirect(303, '/');
};
