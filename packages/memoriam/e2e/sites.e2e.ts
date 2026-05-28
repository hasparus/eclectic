import { test, expect } from '@playwright/test';
import { safeGoto, signInAs, uniqueEmail } from './helpers/auth';

test.describe('site listing + creation', () => {
	test('a new user has no memorials and can create one', async ({ page }) => {
		const email = uniqueEmail('newuser');
		await signInAs(page, email, '/sites');

		await expect(page.getByText(/you don't have any sites yet/i)).toBeVisible();

		await page
			.getByPlaceholder(/display name/i)
			.fill('Grandma Edith');

		// The visibility control is a labelled <select>; selectOption uses
		// the visible option text.
		const visibility = page.getByRole('combobox');
		await visibility.selectOption({ label: 'Unlisted — link required, not searchable' });

		await page.getByRole('button', { name: /create site/i }).click();

		// The new memorial appears in the listing as a link. Follow it
		// to the per-site page — the listing is the system of record.
		const newLink = page.getByRole('link', { name: /grandma edith/i });
		await expect(newLink).toBeVisible();
		await newLink.click();

		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+/);
		await expect(page.getByRole('heading', { name: /grandma edith/i })).toBeVisible();
		await expect(page.getByText(/unlisted/i).first()).toBeVisible();
	});

	test('listing shows existing sites with their role', async ({ page }) => {
		const email = uniqueEmail('multisite');
		await signInAs(page, email, '/sites');

		// Create two sites in succession. After each click the listing
		// updates to include the new memorial; assert against the link.
		for (const name of ['Memorial A', 'Memorial B']) {
			await safeGoto(page, '/sites');
			await page.waitForLoadState('networkidle');
			await page.getByPlaceholder(/display name/i).fill(name);
			await page.getByRole('button', { name: /create site/i }).click();
			await expect(page.getByRole('link', { name })).toBeVisible();
		}

		await safeGoto(page, '/sites');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('link', { name: /memorial a/i })).toBeVisible();
		await expect(page.getByRole('link', { name: /memorial b/i })).toBeVisible();

		// Both rows should label the user as the owner.
		const ownerLines = page.getByText(/you are owner/i);
		await expect(ownerLines).toHaveCount(2);
	});
});
