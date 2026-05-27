import { redirect } from '@sveltejs/kit';
import { acceptInvite } from '$lib/server/members.js';
import { getUser } from '$lib/server/users.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		return { ok: false, reason: 'missing_token' as const };
	}

	// If not signed in, bounce to the magic-link flow with `next` set to
	// come back here. The user has to sign in with the email the invite
	// was sent to; we don't tell them which email until they're in.
	if (!locals.userId) {
		const next = `/auth/invite?token=${encodeURIComponent(token)}`;
		throw redirect(303, `/?next=${encodeURIComponent(next)}`);
	}

	const user = getUser(locals.userId);
	if (!user) {
		return { ok: false, reason: 'unknown_user' as const };
	}

	const result = acceptInvite(token, { user_id: user.user_id, email: user.email });
	if (!result.ok || !result.siteId) {
		return { ok: false, reason: result.reason ?? 'unknown' };
	}

	throw redirect(303, `/sites/${result.siteId}`);
};
