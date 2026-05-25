// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DatabaseSync } from 'node:sqlite';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			site_id: string;
			db: DatabaseSync;
			is_admin: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
