// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DatabaseSync } from 'node:sqlite';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			siteId: string;
			db: DatabaseSync;
			isAdmin: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
