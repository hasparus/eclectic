import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		has_backend: !env.VERCEL,
		is_admin: !!locals.isAdmin,
		origin: env.ORIGIN ?? ''
	};
};
