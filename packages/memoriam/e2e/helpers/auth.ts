import { expect, type Page } from '@playwright/test';
import { awaitPlatformDb, issueMagicLinkToken } from './db.js';

let counter = 0;

/**
 * Allocate a unique email for a test. Avoids cross-test collisions
 * (rate limit, user-already-member, etc.).
 */
export function uniqueEmail(label = 'user'): string {
	counter += 1;
	return `${label}-${Date.now()}-${counter}@e2e.memoriam.local`;
}

/**
 * Sign the page in as `email` by issuing a magic-link token directly
 * via the platform DB and consuming it through `/auth/magic`.
 *
 * Why not drive the `/signin` form? Two reasons:
 *   - The form path goes through `requestMagicLink`, which is rate-
 *     limited per-email and per-IP at 5 requests / hour. A test
 *     suite that re-signs the same email a handful of times trips
 *     the limit and starts returning 429s — which is real product
 *     behavior worth covering, but in *one* dedicated test, not
 *     incidentally in every flow that just needs an authed page.
 *   - The form's purpose (and failure modes) are covered by
 *     `auth.e2e.ts`. Reusing it as plumbing in every other suite
 *     made tests serialize on a slow UI render that wasn't the
 *     thing under test.
 *
 * The behavior under test in *this* helper's callers is what
 * happens *after* a successful sign-in, not the sign-in flow
 * itself — so we skip straight to the consume step.
 */
export async function signInAs(page: Page, email: string, next?: string): Promise<void> {
	// SvelteKit's `init` hook (which creates the platform SQLite file)
	// runs lazily on the first request. Touch any cheap endpoint so
	// the DB file exists before the helper tries to write a token row.
	await page.context().request.get('/signin', { maxRedirects: 0 });
	await awaitPlatformDb();

	const token = issueMagicLinkToken(email);
	const consumeResponse = await page.context().request.get(
		`/auth/magic?token=${encodeURIComponent(token)}`,
		{ maxRedirects: 0 }
	);
	if (consumeResponse.status() !== 303) {
		throw new Error(`/auth/magic returned ${consumeResponse.status()}, expected 303`);
	}

	const target = next ?? '/sites';
	await safeGoto(page, target);
	// Wait for hydration before the caller drives any interaction.
	await page.waitForLoadState('networkidle');
}

/**
 * page.goto can race with SvelteKit's client router or chromium's 303
 * abort logic, surfacing as "interrupted by another navigation" or
 * "ERR_ABORTED". Retry a few times; verify by URL afterward.
 */
export async function safeGoto(page: Page, target: string): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto(target);
			return;
		} catch (err) {
			const m = String(err);
			if (!m.includes('interrupted') && !m.includes('ERR_ABORTED')) throw err;
		}
		await page.waitForTimeout(200);
	}
	throw new Error(`Failed to land on ${target}`);
}

/**
 * Sign the current page out. Navigates to /sites first because that's
 * the only route with a visible Sign out control today. After click,
 * the in-page logout() invalidates the session and navigates to "/" —
 * we wait until we're somewhere that isn't a signed-in route.
 */
export async function signOut(page: Page): Promise<void> {
	await safeGoto(page, '/sites');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /sign out/i }).click();
	await expect(page).toHaveURL(/^(?!.*\/sites($|\/)).*$/, { timeout: 10000 });
}
