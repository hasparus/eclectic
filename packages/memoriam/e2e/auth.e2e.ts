import { test, expect } from '@playwright/test';
import { signInAs, signOut, uniqueEmail } from './helpers/auth';

test.describe('sign in', () => {
	test('a signed-out visitor of /sites is sent to /signin and back after sign-in', async ({
		page
	}) => {
		// Hitting a protected route bounces to /signin?next=/sites.
		await page.goto('/sites');
		await expect(page).toHaveURL(/\/signin\?next=%2Fsites/);
		await page.waitForLoadState('networkidle');

		const email = uniqueEmail('alice');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: /send link/i }).click();
		await expect(page.getByText(/check your email/i)).toBeVisible();

		// The magic-link URL is generated server-side and logged; tests
		// read it directly from the DB. We consume via APIRequestContext
		// so chromium doesn't abort the 303 chain.
		const { latestMagicLinkToken } = await import('./helpers/db');
		const token = latestMagicLinkToken(email);
		await page.context().request.get(
			`/auth/magic?token=${encodeURIComponent(token)}&next=/sites`,
			{ maxRedirects: 0 }
		);
		await page.goto('/sites');

		await expect(page).toHaveURL(/\/sites$/);
		await expect(page.getByRole('heading', { name: /your memorials/i })).toBeVisible();
	});

	test('signing in then signing out clears the session', async ({ page }) => {
		const email = uniqueEmail('bob');
		await signInAs(page, email, '/sites');
		await expect(page.getByRole('heading', { name: /your memorials/i })).toBeVisible();

		await signOut(page);

		// Back at the home page; /sites should now bounce to /signin again.
		await page.goto('/sites');
		await expect(page).toHaveURL(/\/signin/);
	});

	test('rejects an invalid email at the form level', async ({ page }) => {
		await page.goto('/signin');
		await page.getByLabel('Email').fill('not-an-email');
		await page.getByRole('button', { name: /send link/i }).click();
		// HTML5 validation; "check your email" never appears.
		await expect(page.getByText(/check your email/i)).toHaveCount(0);
	});

	test('reusing a magic link a second time shows a clear error', async ({ page }) => {
		const { waitForMagicLinkToken } = await import('./helpers/db');
		const email = uniqueEmail('carol');

		// Issue a fresh token by driving the signin form, then capture it.
		await page.goto('/signin');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: /send link/i }).click();
		const token = await waitForMagicLinkToken(email);

		// Consume it once via APIRequestContext (avoids chromium aborting
		// the 303 chain when we follow with page.goto).
		const first = await page.context().request.get(
			`/auth/magic?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		expect(first.status()).toBe(303);

		// Hit the same link again — this time we want to *see* the error
		// page, not redirect anywhere. The server returns 200 + the page.
		await page.goto(`/auth/magic?token=${encodeURIComponent(token)}`);
		await expect(page.getByRole('heading', { name: /sign-in link error/i })).toBeVisible();
		await expect(page.getByText(/already been used/i)).toBeVisible();
	});
});
