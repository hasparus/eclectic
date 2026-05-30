import { test, expect, type Page } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers/auth';
import { latestInviteToken } from './helpers/db';

// Helpers scoped to the tree page. They take a Page so callers can
// chain locators; the names map to a screen-reader's view of the UI.
function treeCanvas(page: Page) {
	return page.getByRole('figure', { name: /family tree|drzewo/i });
}
function card(page: Page, name: string | RegExp) {
	return treeCanvas(page).getByRole('button', { name });
}
function drawer(page: Page) {
	return page.getByRole('complementary', { name: /person|osoba/i });
}
function modal(page: Page) {
	return page.getByRole('dialog');
}

/**
 * Sign in, create a site with the given display name, and land on
 * its `/sites/[id]/tree` page. Returns the site id.
 */
async function bootSiteAndOpenTree(
	page: Page,
	emailLabel: string,
	siteName: string
): Promise<string> {
	const email = uniqueEmail(emailLabel);
	await signInAs(page, email, '/sites');
	await page.getByPlaceholder(/display name/i).fill(siteName);
	await page.getByRole('button', { name: /create site/i }).click();
	await page.getByRole('link', { name: new RegExp(siteName, 'i') }).click();
	await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
	const siteId = new URL(page.url()).pathname.split('/')[2];
	await page.getByRole('link', { name: /family tree/i }).click();
	await expect(page).toHaveURL(/\/sites\/[a-z0-9]+\/tree$/);
	return siteId;
}

async function seedSubject(page: Page, siteName: string): Promise<void> {
	// Wait for hydration before the click — callers that reach the
	// tree via `page.goto(/tree)` (not an in-app link) need the
	// Svelte 5 handlers to attach to the SSR'd seed button first.
	await page.waitForLoadState('networkidle');
	const seed = page.getByRole('button', {
		name: new RegExp(`set ${siteName} as the subject`, 'i')
	});
	await expect(seed).toBeVisible();
	await seed.click();
	// The figure appears with one labelled card.
	await expect(treeCanvas(page)).toBeVisible();
	await expect(card(page, new RegExp(siteName, 'i'))).toBeVisible();
}

/**
 * Open the drawer for a person by clicking their card on the canvas.
 * Returns the drawer locator scoped for follow-up assertions.
 */
async function selectPersonOnCanvas(page: Page, name: string | RegExp) {
	await card(page, name).click();
	const d = drawer(page);
	// The drawer header is the person's display name.
	await expect(d.getByRole('heading', { name })).toBeVisible();
	return d;
}

test.describe('family tree — seeding the subject', () => {
	test('a new site shows the empty state and seeds the subject from the site name', async ({
		page
	}) => {
		await bootSiteAndOpenTree(page, 'seed-owner', 'Grandma Edith');

		// Empty state: clear heading + CTA.
		await expect(page.getByRole('heading', { name: /no subject set/i })).toBeVisible();
		await expect(treeCanvas(page)).toHaveCount(0);

		await seedSubject(page, 'Grandma Edith');
		// One card, no edges yet.
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(1);
	});

	test('a viewer of a site without a subject sees nothing to edit', async ({ page, browser }) => {
		const ownerEmail = uniqueEmail('seed-owner-2');
		const viewerEmail = uniqueEmail('seed-viewer');
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Empty Site');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /empty site/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
		const siteId = new URL(page.url()).pathname.split('/')[2];

		await page.getByPlaceholder(/email@example\.com/i).fill(viewerEmail);
		await page.getByRole('combobox').last().selectOption({ value: 'viewer' });
		await page.getByRole('button', { name: /send invite/i }).click();
		await expect(page.getByRole('listitem').filter({ hasText: viewerEmail })).toBeVisible();
		const token = latestInviteToken(viewerEmail);

		const viewerCtx = await browser.newContext();
		const viewerPage = await viewerCtx.newPage();
		await signInAs(viewerPage, viewerEmail);
		await viewerPage.context().request.get(
			`/auth/invite?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		await viewerPage.goto(`/sites/${siteId}/tree`);

		// Viewer sees the heading but no CTA to seed a subject.
		await expect(viewerPage.getByRole('heading', { name: /no subject set/i })).toBeVisible();
		await expect(
			viewerPage.getByRole('button', { name: /set.*as the subject/i })
		).toHaveCount(0);

		await viewerCtx.close();
	});
});

test.describe('family tree — editing the focal person', () => {
	test("saving the subject's birth and death renders a lifespan on the card", async ({ page }) => {
		await bootSiteAndOpenTree(page, 'edit-owner', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByLabel(/birth date/i).fill('1925-04-12');
		await d.getByLabel(/death date/i).fill('2018-11-03');
		await d.getByLabel(/birth place/i).fill('Łódź');
		await d.getByRole('combobox', { name: /^sex$/i }).selectOption({ label: 'Female' });
		await d.getByRole('button', { name: /^save$/i }).click();

		// The lifespan is rendered as SVG <text> inside the card.
		// Asserting on visible text is the accessible equivalent of
		// asserting on the card's title row.
		await expect(treeCanvas(page).getByText('1925 — 2018')).toBeVisible();

		// And on a hard reload the data is in the platform DB, not in
		// in-memory $state.
		await page.reload();
		await expect(treeCanvas(page).getByText('1925 — 2018')).toBeVisible();
		await card(page, /grandma edith/i).click();
		await expect(drawer(page).getByLabel(/birth place/i)).toHaveValue('Łódź');
	});

	test('the save button surfaces the trim of the display name', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'edit-trim', 'Aunt Margaret');
		await seedSubject(page, 'Aunt Margaret');
		const d = await selectPersonOnCanvas(page, /aunt margaret/i);

		// Whitespace-only display_name should be rejected by the
		// valibot pipeline as "minLength 1 after trim".
		await d.getByLabel(/display name/i).fill('   ');
		await d.getByRole('button', { name: /^save$/i }).click();

		// Either the input's HTML `required` constraint or the server
		// guard catches it; the original card stays untouched.
		await expect(card(page, /aunt margaret/i)).toBeVisible();
	});
});

test.describe('family tree — building out relatives', () => {
	test('adding a father from the subject drawer adds a connected card', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'add-parent', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByRole('button', { name: /\+ parent/i }).click();
		const m = modal(page);
		await expect(m.getByRole('heading', { name: /add a parent of grandma edith/i })).toBeVisible();
		await m.getByLabel(/display name/i).fill('Marek Holloway');
		await m.getByLabel(/birth date/i).fill('1898');
		await m.getByRole('combobox', { name: /^sex$/i }).selectOption({ label: 'Male' });
		await m.getByRole('combobox', { name: /^relationship$/i }).selectOption({ value: 'biological' });
		await m.getByRole('button', { name: /^add$/i }).click();

		// Canvas now has both subject and new parent.
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(2);
		await expect(card(page, /grandma edith/i)).toBeVisible();
		await expect(card(page, /marek holloway/i)).toBeVisible();

		// The new card is selectable; its drawer pre-fills with the
		// values from the modal.
		const parentDrawer = await selectPersonOnCanvas(page, /marek holloway/i);
		await expect(parentDrawer.getByLabel(/birth date/i)).toHaveValue('1898');
		await expect(parentDrawer.getByRole('combobox', { name: /^sex$/i })).toHaveValue('M');
	});

	test('cancelling the add-parent modal leaves the canvas untouched', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'add-cancel', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByRole('button', { name: /\+ parent/i }).click();
		const m = modal(page);
		await m.getByLabel(/display name/i).fill('Should Not Land');
		await m.getByRole('button', { name: /^cancel$/i }).click();

		// Modal gone, card not created.
		await expect(modal(page)).toHaveCount(0);
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(1);
		await expect(treeCanvas(page).getByText(/should not land/i)).toHaveCount(0);
	});

	test('adding two parents and a spouse produces a four-card tree', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'family', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// Subject → + parent Marek.
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Marek Holloway');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(2);

		// Subject → + parent Anna.
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Anna Holloway');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(3);

		// Marek → + spouse Helena (a second wife).
		await (await selectPersonOnCanvas(page, /marek holloway/i))
			.getByRole('button', { name: /\+ spouse/i })
			.click();
		await expect(modal(page).getByRole('heading', { name: /add a spouse of marek holloway/i })).toBeVisible();
		await modal(page).getByLabel(/display name/i).fill('Helena Kowalska');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(4);

		// Every person we created is reachable through their accessible
		// name — a more strict check than "count 4".
		for (const name of [/grandma edith/i, /marek holloway/i, /anna holloway/i, /helena kowalska/i]) {
			await expect(card(page, name)).toBeVisible();
		}
	});

	test('adding a child of the subject connects them in the tree', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'add-child', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ child/i })
			.click();
		await expect(modal(page).getByRole('heading', { name: /add a child of grandma edith/i })).toBeVisible();
		await modal(page).getByLabel(/display name/i).fill('Mother');
		await modal(page).getByLabel(/birth date/i).fill('1948');
		await modal(page).getByRole('button', { name: /^add$/i }).click();

		await expect(treeCanvas(page).getByRole('button')).toHaveCount(2);
		await expect(card(page, /mother/i)).toBeVisible();
	});

	test('the spouse modal does not show the bio/adoptive kind selector', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'spouse-kind', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ spouse/i })
			.click();
		// The "Relationship" select is only meaningful for parent-of edges
		// (bio / adoptive / foster / step). Couples have their own kind
		// schema (marriage / partnership / etc.) which Phase A doesn't
		// expose in the modal yet — so neither selector should appear.
		await expect(modal(page).getByRole('combobox', { name: /^relationship$/i })).toHaveCount(0);
	});
});

test.describe('family tree — access control', () => {
	test('a viewer sees the tree but no add-relative affordances or save button', async ({
		page,
		browser
	}) => {
		const ownerEmail = uniqueEmail('acl-owner');
		const viewerEmail = uniqueEmail('acl-viewer');

		// Owner builds a 2-person tree.
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Aunt Margaret');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /aunt margaret/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
		const siteId = new URL(page.url()).pathname.split('/')[2];

		await page.goto(`/sites/${siteId}/tree`);
		await seedSubject(page, 'Aunt Margaret');
		await (await selectPersonOnCanvas(page, /aunt margaret/i))
			.getByRole('button', { name: /\+ child/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Niece Helena');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(2);

		// Invite a viewer.
		await page.goto(`/sites/${siteId}`);
		await page.getByPlaceholder(/email@example\.com/i).fill(viewerEmail);
		await page.getByRole('combobox').last().selectOption({ value: 'viewer' });
		await page.getByRole('button', { name: /send invite/i }).click();
		await expect(page.getByRole('listitem').filter({ hasText: viewerEmail })).toBeVisible();
		const token = latestInviteToken(viewerEmail);

		// Viewer accepts + opens the tree.
		const viewerCtx = await browser.newContext();
		const viewerPage = await viewerCtx.newPage();
		await signInAs(viewerPage, viewerEmail);
		await viewerPage.context().request.get(
			`/auth/invite?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		await viewerPage.goto(`/sites/${siteId}/tree`);

		// Tree visible, both cards present.
		await expect(treeCanvas(viewerPage)).toBeVisible();
		await expect(treeCanvas(viewerPage).getByRole('button')).toHaveCount(2);

		// Open the drawer — no edit affordances visible.
		await card(viewerPage, /aunt margaret/i).click();
		const d = drawer(viewerPage);
		await expect(d.getByRole('button', { name: /\+ parent/i })).toHaveCount(0);
		await expect(d.getByRole('button', { name: /\+ spouse/i })).toHaveCount(0);
		await expect(d.getByRole('button', { name: /\+ child/i })).toHaveCount(0);
		await expect(d.getByRole('button', { name: /^save$/i })).toHaveCount(0);

		await viewerCtx.close();
	});
});

test.describe('family tree — Phase B fixes', () => {
	test('typing a death date auto-unchecks the Living checkbox', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'living', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		// A freshly-seeded subject is Living by default.
		await expect(d.getByRole('checkbox', { name: /^living$/i })).toBeChecked();

		// Filling a death date should auto-clear the Living flag — the
		// previous form left it checked, which the server then trusted.
		await d.getByLabel(/death date/i).fill('2018-11-03');
		await expect(d.getByRole('checkbox', { name: /^living$/i })).not.toBeChecked();
	});

	test('the Saved confirmation appears for a moment after a successful save', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'toast', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByLabel(/birth place/i).fill('Łódź');
		await d.getByRole('button', { name: /^save$/i }).click();

		// `role="status"` + `aria-live="polite"` is what we render — the
		// screen-reader-friendly equivalent of a toast. Visible briefly.
		await expect(page.getByRole('status').filter({ hasText: /saved\.?/i })).toBeVisible();
	});

	test('reloading the tree page restores the selected person from the URL', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'urlstate', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await card(page, /grandma edith/i).click();
		await expect(drawer(page)).toBeVisible();

		// URL now carries `?focus=<id>` — assert it's there.
		await expect(page).toHaveURL(/\?focus=/);

		// Reload. The selection is restored from the query param, no
		// click needed.
		await page.reload();
		await expect(drawer(page).getByRole('heading', { name: /grandma edith/i })).toBeVisible();
	});

	test('pressing Escape closes the modal without committing', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'modal-esc', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByRole('button', { name: /\+ parent/i }).click();
		await expect(modal(page)).toBeVisible();
		await modal(page).getByLabel(/display name/i).fill('Should Not Land');

		await page.keyboard.press('Escape');

		await expect(modal(page)).toHaveCount(0);
		// And the canvas still has just the subject.
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(1);
	});

	test('pressing Escape with no modal closes the drawer', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'drawer-esc', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await selectPersonOnCanvas(page, /grandma edith/i);

		await page.keyboard.press('Escape');
		await expect(drawer(page)).toHaveCount(0);
		// And the URL `focus` param is cleared.
		await expect(page).not.toHaveURL(/\?focus=/);
	});

	test('Delete person removes the card from the canvas', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'delete', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// Add a child so we have something safe to delete (deleting the
		// subject would null `subject_person_id` and re-show the empty
		// state — still valid, but a tree of 2 → 1 is a cleaner
		// assertion).
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ child/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Future Child');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(treeCanvas(page).getByRole('button')).toHaveCount(2);

		// Open the child's drawer, click Delete person, confirm the
		// confirm dialog.
		await card(page, /future child/i).click();
		page.once('dialog', (dialog) => void dialog.accept());
		await drawer(page).getByRole('button', { name: /delete person/i }).click();

		await expect(treeCanvas(page).getByRole('button')).toHaveCount(1);
		// Drawer closes; URL focus is cleared.
		await expect(drawer(page)).toHaveCount(0);
	});

	test('the SVG canvas advertises pan/zoom cursors', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'zoom', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// We can't assert d3-zoom's transform without inspecting DOM
		// internals, but the canvas SVG should be tagged with the
		// pan/zoom cursor classes — proof the action mounted.
		const svg = treeCanvas(page);
		await expect(svg).toHaveClass(/cursor-grab/);
	});
});

test.describe('family tree — i18n', () => {
	test('Polish locale renders the tree page and drawer in Polish', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'pl-tree', 'Babcia Helena');
		await seedSubject(page, 'Babcia Helena');

		// Flip to Polish via the locale switcher on /sites.
		await page.goto('/sites');
		await page.getByRole('button', { name: 'Polski' }).click();
		await page.waitForLoadState('networkidle');

		// Navigate back to the tree route — the cookie persists across
		// navigations, so the next render is fully Polish.
		await page.getByRole('link', { name: /babcia helena/i }).click();
		await page.getByRole('link', { name: /drzewo genealogiczne/i }).click();

		await expect(page.getByRole('heading', { name: /^drzewo genealogiczne$/i })).toBeVisible();

		// Drawer affordances are translated.
		await card(page, /babcia helena/i).click();
		const d = drawer(page);
		await expect(d.getByRole('button', { name: /\+ rodzic/i })).toBeVisible();
		await expect(d.getByRole('button', { name: /\+ współmałżonek/i })).toBeVisible();
		await expect(d.getByRole('button', { name: /\+ dziecko/i })).toBeVisible();
		await expect(d.getByRole('button', { name: /^zapisz$/i })).toBeVisible();

		// And the modal heading uses the Polish interpolation.
		await d.getByRole('button', { name: /\+ rodzic/i }).click();
		await expect(
			modal(page).getByRole('heading', { name: /dodaj rodzica osoby babcia helena/i })
		).toBeVisible();
	});
});
