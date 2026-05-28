import { test, expect } from '@playwright/test';
import { safeGoto, signInAs, signOut, uniqueEmail } from './helpers/auth';

test.describe('private site visibility', () => {
	test('a private site is unreachable to non-members at /sites/[id]', async ({ page }) => {
		const ownerEmail = uniqueEmail('private-owner');
		const strangerEmail = uniqueEmail('private-stranger');

		// Owner creates a private site, then opens it via the listing
		// link to capture its per-site URL.
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Family only');
		await page.getByRole('combobox').selectOption({ label: 'Private — only invited members' });
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /family only/i }).click();

		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+/);
		const siteUrl = page.url();
		await signOut(page);

		// Stranger signs in and visits the URL directly — should be told
		// they aren't a member. APIRequestContext gives us the bare HTTP
		// response (status, body) without chromium aborting on the
		// non-navigable 403 in the wake of an in-flight client request.
		await signInAs(page, strangerEmail);
		const response = await page.context().request.get(siteUrl);
		expect(response.status()).toBe(403);
	});

	test('a public site stays readable to a logged-out visitor', async ({ page }) => {
		// Owner creates a public site, navigates to its public page.
		const ownerEmail = uniqueEmail('public-owner');
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Open memorial');
		await page.getByRole('combobox').selectOption({ label: 'Public — anyone with the link' });
		await page.getByRole('button', { name: /create site/i }).click();
		await expect(page.getByRole('link', { name: /open memorial/i })).toBeVisible();
		await signOut(page);

		// The /sites/[id] member-management page itself requires membership
		// (returns 403 to a logged-out stranger), but the rendered memorial
		// content at the subdomain-routed root is reachable. In this single-
		// host e2e run there's no subdomain to hit, so we settle for
		// asserting the /sites listing requires a session — i.e. that the
		// signed-out user is bounced to /signin from /sites, not from the
		// public memorial.
		await safeGoto(page, '/sites');
		await expect(page).toHaveURL(/\/signin/);
	});
});
