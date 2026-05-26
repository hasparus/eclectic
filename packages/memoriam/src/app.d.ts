// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DatabaseSync } from 'node:sqlite';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Resolved site for this request, or null on platform-only routes (e.g. /signin). */
			siteId: string | null;
			/** Per-site DB, or null when siteId is null. */
			db: DatabaseSync | null;
			/** Platform-wide DB. Always available. */
			platformDb: DatabaseSync;
			/** Authenticated user id (from platform session cookie), or null. */
			userId: string | null;
			/** Authenticated user email, or null. */
			userEmail: string | null;
			/** True iff the authenticated user can edit the resolved site. */
			isAdmin: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
