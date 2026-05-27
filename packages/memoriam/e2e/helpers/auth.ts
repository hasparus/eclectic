import { expect, type Page } from '@playwright/test';
import { awaitPlatformDb, waitForMagicLinkToken } from './db.js';

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
 * Sign the page in as `email`, end-to-end through the real UI:
 *   1. Visit /signin (carrying `next` if given).
 *   2. Wait for hydration before driving the form.
 *   3. Fill the labelled email input, click "Send link".
 *   4. Poll the platform DB for the issued magic-link token (the dev
 *      stack logs the link but never emails it).
 *   5. Drive `/auth/magic` via the shared APIRequestContext so the
 *      Set-Cookie applies to the page without tripping chromium's
 *      ERR_ABORTED on the 303 chain.
 *   6. Navigate to the target page.
 *
 * The form's post-click UI state ("Check your email") is asserted by
 * the dedicated auth spec — here we wait for the DB token as an
 * equivalent signal, free of Svelte re-mount timing.
 */
export async function signInAs(page: Page, email: string, next?: string): Promise<void> {
	// Visit /signin first — that wakes the dev server, which triggers
	// SvelteKit's `init()` hook and materializes the platform DB file.
	// Only then does awaitPlatformDb (which is otherwise a no-op once
	// the file exists) have something to find.
	const signinUrl = next ? `/signin?next=${encodeURIComponent(next)}` : '/signin';
	await page.goto(signinUrl);
	await page.waitForLoadState('networkidle');
	await awaitPlatformDb();

	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: /send link/i }).click();

	// Wait for the success-state UI before reading the DB — this both
	// confirms the click reached the handler (i.e. hydration was done)
	// and gives the server a moment to commit the token row.
	await page.getByText(/check your email/i).waitFor({ state: 'visible' });

	const token = await waitForMagicLinkToken(email);
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
