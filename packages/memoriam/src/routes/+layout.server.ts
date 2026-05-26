import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		is_admin: !!locals.isAdmin,
		origin: env.ORIGIN ?? ''
	};
};
