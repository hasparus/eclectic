import { test, expect } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers/auth';

test.describe('family tree (Phase A)', () => {
	test('subject seeding + adding a parent renders both cards on the canvas', async ({ page }) => {
		const email = uniqueEmail('tree-owner');

		// Create a site whose display name will seed the subject.
		await signInAs(page, email, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Grandma Edith');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /grandma edith/i }).click();

		// Follow the "Family tree" entry from the site dashboard.
		await page.getByRole('link', { name: /family tree/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+\/tree$/);

		// No subject yet — the seed button uses the site display name.
		const seedButton = page.getByRole('button', { name: /set grandma edith as the subject/i });
		await expect(seedButton).toBeVisible();
		await seedButton.click();

		// After seeding, the tree canvas appears with the subject card.
		const canvas = page.getByTestId('tree-canvas');
		await expect(canvas).toBeVisible();
		const cards = page.getByTestId('tree-card');
		await expect(cards).toHaveCount(1);

		// Click the subject card → side drawer opens with the edit form.
		await cards.first().click();
		await expect(page.getByRole('heading', { name: /grandma edith/i })).toBeVisible();

		// Add a parent. Use the "+ Parent" affordance in the drawer.
		await page.getByRole('button', { name: /\+ parent/i }).click();

		// The modal asks for the parent's display name; ICU-style title
		// embeds the anchor name.
		const modal = page.getByRole('dialog');
		await expect(
			modal.getByRole('heading', { name: /add a parent of grandma edith/i })
		).toBeVisible();
		await modal.getByLabel(/display name/i).fill('Great-Grandma Mary');
		await modal.getByRole('button', { name: /^add$/i }).click();

		// After the round-trip the canvas re-lays out with two cards.
		await expect(cards).toHaveCount(2, { timeout: 5000 });

		// And the new parent card is selectable / shows up in the canvas.
		await expect(page.getByText(/great-grandma mary/i).first()).toBeVisible();
	});

	test('viewer role sees the tree but cannot edit', async ({ page, browser }) => {
		const ownerEmail = uniqueEmail('tree-owner-2');
		const viewerEmail = uniqueEmail('tree-viewer');

		// Owner creates a site, seeds a subject, adds a child so there are
		// two nodes to render.
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Aunt Margaret');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /aunt margaret/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
		const siteUrl = new URL(page.url());
		const siteId = siteUrl.pathname.split('/')[2];

		await page.goto(`/sites/${siteId}/tree`);
		await page.waitForLoadState('networkidle');
		const seedBtn = page.getByRole('button', { name: /set aunt margaret as the subject/i });
		await expect(seedBtn).toBeVisible({ timeout: 10000 });
		await seedBtn.click();
		await page.getByTestId('tree-card').first().click();
		await page.getByRole('button', { name: /\+ child/i }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel(/display name/i).fill('Niece Helena');
		await modal.getByRole('button', { name: /^add$/i }).click();
		await expect(page.getByTestId('tree-card')).toHaveCount(2, { timeout: 5000 });

		// Invite viewerEmail as a viewer; consume the invite in a fresh
		// browser context so they're logged in as the viewer.
		await page.goto(`/sites/${siteId}`);
		await page.getByPlaceholder(/email@example\.com/i).fill(viewerEmail);
		// Default role is editor; switch to viewer.
		const inviteCombos = page.getByRole('combobox');
		await inviteCombos.last().selectOption({ value: 'viewer' });
		await page.getByRole('button', { name: /send invite/i }).click();
		// Wait for the pending-invites row to render — that's the
		// observable proof the invite landed in the DB.
		await expect(
			page.getByRole('listitem').filter({ hasText: viewerEmail })
		).toBeVisible();

		const { latestInviteToken } = await import('./helpers/db.js');
		const token = latestInviteToken(viewerEmail);

		// Viewer signs in as themselves, accepts the invite.
		const viewerContext = await browser.newContext();
		const viewerPage = await viewerContext.newPage();
		await signInAs(viewerPage, viewerEmail);
		const acceptResponse = await viewerPage.context().request.get(
			`/auth/invite?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		expect(acceptResponse.status()).toBe(303);

		// Viewer opens the tree page — should see the canvas but no
		// "+ Parent / + Spouse / + Child" affordances.
		await viewerPage.goto(`/sites/${siteId}/tree`);
		await expect(viewerPage.getByTestId('tree-canvas')).toBeVisible();
		await expect(viewerPage.getByTestId('tree-card')).toHaveCount(2);
		await viewerPage.getByTestId('tree-card').first().click();
		await expect(viewerPage.getByRole('button', { name: /\+ parent/i })).toHaveCount(0);

		await viewerContext.close();
	});
});
