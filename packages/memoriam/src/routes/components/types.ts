// Shared component-tier types.
//
// `svedit` context: every editable component does `getContext('svedit')`
// to reach the live Session. The svedit package's types are too loose to
// be useful here; we lean on `any` for the field access surface and let
// runtime checks catch mistakes.

import type { Session } from 'svedit';

export interface SveditCtx {
	session: Session & Record<string, any>;
	editable: boolean;
	[key: string]: any;
}

// App context (set in App.svelte via setContext('app', ...)).
export interface AppCtx {
	is_admin: boolean;
	origin: string | null;
	auth_dialog_open: boolean;
	close_auth_dialog: () => void;
	edit_for_fun: () => void;
	handle_auth_success: () => Promise<void> | void;
}
