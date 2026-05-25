import { createContext } from 'svelte';

interface PageBrowserPage {
	document_id?: string;
	page_href?: string;
	[key: string]: any;
}

interface PageBrowserState {
	open: boolean;
	mode: 'navigate' | 'select';
	on_select_page: ((page: PageBrowserPage) => void) | null;
}

export interface PageBrowserOptions {
	goto: (href: string) => Promise<void> | void;
	is_admin: () => boolean;
}

export interface PageBrowser {
	readonly state: PageBrowserState;
	open_navigate(): void;
	open_select(on_select_page: (page: PageBrowserPage) => void): void;
	close(): void;
	handle_page_selected(page: PageBrowserPage | null): void;
	handle_page_deleted(
		document_id: string,
		home_page_id: string | null,
		current_document_id: string | null
	): Promise<void>;
	invalidate?: () => void;
	version?: number;
}

export const [get_page_browser, set_page_browser] = createContext<PageBrowser>();

export function create_page_browser(options: PageBrowserOptions): PageBrowser {
	const { goto, is_admin } = options;

	const state = $state<PageBrowserState>({
		open: false,
		mode: 'navigate',
		on_select_page: null
	});

	function reset() {
		state.open = false;
		state.mode = 'navigate';
		state.on_select_page = null;
	}

	function open_navigate() {
		if (!is_admin()) return;
		state.mode = 'navigate';
		state.on_select_page = null;
		state.open = true;
	}

	function open_select(on_select_page: (page: PageBrowserPage) => void) {
		if (!is_admin()) return;
		state.mode = 'select';
		state.on_select_page = on_select_page;
		state.open = true;
	}

	function close() {
		reset();
	}

	function handle_page_selected(page: PageBrowserPage | null) {
		if (state.mode === 'select' && state.on_select_page) {
			if (page) state.on_select_page(page);
			reset();
			return;
		}

		reset();
		if (page?.page_href) {
			void goto(page.page_href);
		}
	}

	async function handle_page_deleted(
		document_id: string,
		home_page_id: string | null,
		current_document_id: string | null
	) {
		if (current_document_id !== document_id) return;

		reset();
		if (home_page_id) {
			await goto('/');
		}
	}

	return {
		get state() {
			return state;
		},
		open_navigate,
		open_select,
		close,
		handle_page_selected,
		handle_page_deleted
	};
}
