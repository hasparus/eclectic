// Stub for SvelteKit's `$env/dynamic/private` virtual module so unit
// tests can import server-side modules without a running SvelteKit
// process. Reads from `process.env` directly.
export const env: Record<string, string | undefined> = new Proxy(
	{} as Record<string, string | undefined>,
	{
		get(_target, prop) {
			if (typeof prop === 'string') return process.env[prop];
			return undefined;
		}
	}
);
