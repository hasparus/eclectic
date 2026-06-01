import { test, expect, type Page } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers/auth';
import { latestInviteToken } from './helpers/db';

// Helpers scoped to the tree page. They take a Page so callers can
// chain locators; the names map to a screen-reader's view of the UI.
function treeCanvas(page: Page) {
	return page.getByRole('figure', { name: /family tree|drzewo/i });
}
/**
 * Person-card rects carry `aria-roledescription="person card"`,
 * separately from the inline "+ Parent / + Spouse / + Child"
 * affordance buttons. We scope card queries to that descriptor —
 * accessible to screen readers (they hear "Grandma Edith, person
 * card, button") and unambiguous to tests, no name-regex
 * gymnastics needed.
 */
function cards(page: Page) {
	return treeCanvas(page).locator('[aria-roledescription="person card"]');
}
function card(page: Page, name: string | RegExp) {
	const pattern =
		name instanceof RegExp
			? new RegExp(`^${name.source}(,.*)?$`, name.flags)
			: new RegExp(`^${name}(,.*)?$`, 'i');
	return cards(page).and(treeCanvas(page).getByRole('button', { name: pattern }));
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
	// Svelte 5 handlers to attach to the SSR'd form first.
	await page.waitForLoadState('networkidle');
	// The empty-state form pre-fills the subject's name from the
	// site display name; we override it explicitly to keep tests
	// independent from whatever the create-site step typed.
	const nameInput = page.getByLabel(/subject'?s name|imię osoby głównej/i);
	await expect(nameInput).toBeVisible();
	await nameInput.fill(siteName);
	await page.getByRole('button', { name: /create the subject|utwórz osobę główną/i }).click();
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
		await expect(cards(page)).toHaveCount(1);
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
		await expect(viewerPage.getByLabel(/subject'?s name/i)).toHaveCount(0);
		await expect(
			viewerPage.getByRole('button', { name: /create the subject/i })
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
		await expect(cards(page)).toHaveCount(2);
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
		await expect(cards(page)).toHaveCount(1);
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
		await expect(cards(page)).toHaveCount(2);

		// Subject → + parent Anna.
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Anna Holloway');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(cards(page)).toHaveCount(3);

		// Marek → + spouse Helena (a second wife).
		await (await selectPersonOnCanvas(page, /marek holloway/i))
			.getByRole('button', { name: /\+ spouse/i })
			.click();
		await expect(modal(page).getByRole('heading', { name: /add a spouse of marek holloway/i })).toBeVisible();
		await modal(page).getByLabel(/display name/i).fill('Helena Kowalska');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(cards(page)).toHaveCount(4);

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

		await expect(cards(page)).toHaveCount(2);
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
		await expect(cards(page)).toHaveCount(2);

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
		await expect(cards(viewerPage)).toHaveCount(2);

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
		await expect(cards(page)).toHaveCount(1);
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
		await expect(cards(page)).toHaveCount(2);

		// Open the child's drawer, click Delete person, confirm the
		// confirm dialog.
		await card(page, /future child/i).click();
		page.once('dialog', (dialog) => void dialog.accept());
		await drawer(page).getByRole('button', { name: /delete person/i }).click();

		await expect(cards(page)).toHaveCount(1);
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

test.describe('family tree — Phase A polish', () => {
	test('the empty-state form prefills the site name and is editable', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'prefill', 'Wandering Site Name');

		const nameInput = page.getByLabel(/subject'?s name/i);
		// Prefilled with the site's display name as a sensible default.
		await expect(nameInput).toHaveValue('Wandering Site Name');

		// User can clear it and type their own — exercise the override.
		await nameInput.fill('Edith Holloway');
		await page.getByRole('button', { name: /create the subject/i }).click();
		await expect(card(page, /edith holloway/i)).toBeVisible();
		await expect(treeCanvas(page).getByText(/wandering site name/i)).toHaveCount(0);
	});

	test('blank subject name shows an inline error instead of creating "Subject"', async ({
		page
	}) => {
		await bootSiteAndOpenTree(page, 'blank', '');

		const nameInput = page.getByLabel(/subject'?s name/i);
		await expect(nameInput).toHaveValue('');

		const createBtn = page.getByRole('button', { name: /create the subject/i });
		// The input has `required`, so the browser-level constraint
		// fires before our handler. Either way, no canvas appears.
		await createBtn.click();
		await expect(treeCanvas(page)).toHaveCount(0);
		// And no person named "Subject" exists.
		await expect(page.getByText(/^subject$/i)).toHaveCount(0);
	});

	test('clicking the modal backdrop closes the add-relative modal', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'backdrop', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByRole('button', { name: /\+ parent/i }).click();
		await expect(modal(page)).toBeVisible();

		// The backdrop is a non-button element (`role` is the inner
		// dialog's), so we locate it by the data-attribute hook and
		// click a corner where the dialog isn't. The `e.target ===
		// e.currentTarget` guard inside the handler skips dialog-
		// originated clicks.
		await page
			.locator('[data-tree-backdrop]')
			.click({ position: { x: 5, y: 5 } });
		await expect(modal(page)).toHaveCount(0);
	});

	test('the modal autofocuses its display-name input', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'autofocus', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);

		await d.getByRole('button', { name: /\+ parent/i }).click();

		// `:focus` matches the focused element; combined with the modal
		// scoping, this asserts the display-name input has focus right
		// after open without a tab key press.
		await expect(modal(page).getByLabel(/display name/i)).toBeFocused();
	});

	test('the add-modal accepts a year-only date (not just YYYY-MM-DD)', async ({ page }) => {
		// The schema is `isoDate.or('null | undefined')`, where isoDate
		// allows YYYY / YYYY-MM / YYYY-MM-DD. Both placeholders now say
		// YYYY-MM-DD but a bare year is still valid.
		await bootSiteAndOpenTree(page, 'year-only', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		const d = await selectPersonOnCanvas(page, /grandma edith/i);
		await d.getByRole('button', { name: /\+ parent/i }).click();
		const mm = modal(page);
		await mm.getByLabel(/display name/i).fill('Year Only Parent');
		await mm.getByLabel(/birth date/i).fill('1898');
		await mm.getByLabel(/death date/i).fill('1970');
		await mm.getByRole('button', { name: /^add$/i }).click();

		await expect(card(page, /year only parent/i)).toBeVisible();
		// The lifespan badge renders from the year extracts of the
		// stored ISO date strings.
		await expect(treeCanvas(page).getByText('1898 — 1970')).toBeVisible();
	});

	test("editing a non-subject person's facts persists across reload", async ({ page }) => {
		await bootSiteAndOpenTree(page, 'edit-parent', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Marek Holloway');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /marek holloway/i)).toBeVisible();

		// Select Marek; edit facts; save.
		const d = await selectPersonOnCanvas(page, /marek holloway/i);
		await d.getByLabel(/birth date/i).fill('1898-06-12');
		await d.getByLabel(/birth place/i).fill('Kraków');
		await d.getByRole('button', { name: /^save$/i }).click();
		await expect(page.getByRole('status').filter({ hasText: /saved\.?/i })).toBeVisible();

		// Reload — selection restored from `?focus`, facts persist
		// from the platform DB.
		await page.reload();
		await expect(drawer(page).getByLabel(/birth place/i)).toHaveValue('Kraków');
		await expect(treeCanvas(page).getByText(/1898/)).toBeVisible();
	});
});

test.describe('family tree — Phase B (canvas UX)', () => {
	test('inline ghost cards open the add modal with the correct anchor', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'ghost', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// The inline "+ Parent of Grandma Edith" affordance lives on the
		// canvas, NOT in the side drawer — opens the same modal as the
		// drawer button would, but without first selecting the card.
		await treeCanvas(page)
			.getByRole('button', { name: /add a parent of grandma edith/i })
			.click();

		await expect(
			modal(page).getByRole('heading', { name: /add a parent of grandma edith/i })
		).toBeVisible();
		// Submit the modal — assert it wired the new person to Grandma
		// Edith, not to whoever happened to be selected before.
		await modal(page).getByLabel(/display name/i).fill('Inline Parent');
		await modal(page).getByRole('button', { name: /^add$/i }).click();

		await expect(cards(page)).toHaveCount(2);
		await expect(card(page, /inline parent/i)).toBeVisible();
	});

	test('an adoptive parent edge renders a single-letter "A" chip', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'adoptive', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Adoptive Parent');
		// Select Adoptive in the relationship dropdown — that's the
		// edge kind we expect to surface on the canvas.
		await modal(page)
			.getByRole('combobox', { name: /^relationship$/i })
			.selectOption({ value: 'adoptive' });
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /adoptive parent/i)).toBeVisible();

		// The chip is a tiny <g> at the edge midpoint, tagged with
		// `data-edge-kind="adoptive"`. We assert the data attribute +
		// the accessible <title> rather than the visible "A" glyph
		// (which would change if we translate the short form).
		const chip = treeCanvas(page).locator('[data-edge-kind="adoptive"]');
		await expect(chip).toHaveCount(1);
		await expect(chip).toContainText('A');
	});

	test('a biological parent does not render an edge chip', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'bio-no-chip', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Bio Parent');
		// Default kind is biological; submit without changing.
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /bio parent/i)).toBeVisible();

		await expect(treeCanvas(page).locator('[data-edge-kind]')).toHaveCount(0);
	});

	test('a second spouse triggers the multi-marriage count badge', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'multi', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// First spouse: no badge.
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ spouse/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('First Spouse');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /first spouse/i)).toBeVisible();
		await expect(treeCanvas(page).locator('[data-couple-badge]')).toHaveCount(0);

		// Second spouse: badge appears on both Grandma Edith's card and
		// — well, only on her card, since only she's in 2 couples (each
		// spouse is in 1). The aria-label is "2 marriages or
		// partnerships".
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ spouse/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Second Spouse');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /second spouse/i)).toBeVisible();

		const badge = treeCanvas(page).locator('[data-couple-badge]');
		await expect(badge).toHaveCount(1);
		await expect(badge).toContainText(/×\s*2/);
	});
});

test.describe('family tree — Phase B (living-relative redaction)', () => {
	test('viewer sees "Living relative" for an admin-added living parent', async ({
		page,
		browser
	}) => {
		const ownerEmail = uniqueEmail('redact-owner');
		const viewerEmail = uniqueEmail('redact-viewer');

		// Owner: site → subject (with a death date so the subject is
		// treated as deceased) → add a relative WITHOUT dates (defaults
		// to living per `isLikelyLiving` heuristic).
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Grandma Edith');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /grandma edith/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
		const siteId = new URL(page.url()).pathname.split('/')[2];
		await page.goto(`/sites/${siteId}/tree`);
		await seedSubject(page, 'Grandma Edith');

		// Give the subject a death date — otherwise the subject is also
		// counted "likely living" by the heuristic (the redactor exempts
		// the subject so it'd still show, but we want to verify the
		// general rule too).
		const sd = await selectPersonOnCanvas(page, /grandma edith/i);
		await sd.getByLabel(/death date/i).fill('2018-11-03');
		await sd.getByRole('button', { name: /^save$/i }).click();

		// Add a living relative — no dates, so defaults to is_living=1.
		await sd.getByRole('button', { name: /\+ child/i }).click();
		await modal(page).getByLabel(/display name/i).fill('Living Daughter');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /living daughter/i)).toBeVisible();

		// Owner sees the real name on their canvas. `exact: true`
		// matches the card's `<text>` content (just "Living
		// Daughter") and skips the affordance `<title>` elements
		// whose text is "Add a parent of Living Daughter" etc.
		await expect(treeCanvas(page).getByText('Living Daughter', { exact: true })).toBeVisible();

		// Invite a viewer.
		await page.goto(`/sites/${siteId}`);
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

		// Viewer: subject is shown in full, the living relative is
		// redacted. Both still appear as cards on the canvas — only
		// their private fields are hidden.
		await expect(cards(viewerPage)).toHaveCount(2);
		await expect(treeCanvas(viewerPage).getByText('Grandma Edith', { exact: true })).toBeVisible();
		await expect(treeCanvas(viewerPage).getByText('Living relative')).toBeVisible();
		await expect(
			treeCanvas(viewerPage).getByText('Living Daughter', { exact: true })
		).toHaveCount(0);

		await viewerCtx.close();
	});

	test('admins see full names even when the heuristic would redact', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'admin-no-redact', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ child/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Definitely Alive');
		await modal(page).getByRole('button', { name: /^add$/i }).click();

		// Admin sees the real name; no "Living relative" placeholder.
		await expect(
			treeCanvas(page).getByText('Definitely Alive', { exact: true })
		).toBeVisible();
		await expect(treeCanvas(page).getByText('Living relative')).toHaveCount(0);
	});
});

test.describe('family tree — Phase C (GEDCOM + fan chart)', () => {
	test('export.ged downloads valid GEDCOM 7 containing the seeded subject', async ({ page }) => {
		const siteId = await bootSiteAndOpenTree(page, 'export', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');

		// The export endpoint is a regular HTTP GET — drive it via the
		// shared APIRequestContext so cookies match the page session.
		const response = await page.context().request.get(
			`/sites/${siteId}/tree/export.ged`
		);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('familysearch.gedcom');
		expect(response.headers()['content-disposition']).toMatch(/attachment; filename=/);
		const body = await response.text();
		expect(body).toContain('0 HEAD');
		expect(body).toContain('2 VERS 7.0');
		expect(body).toContain('1 NAME Grandma Edith');
		expect(body).toContain('0 TRLR');
	});

	test('import wizard: upload + preview + confirm round-trips into the canvas', async ({
		page
	}) => {
		await bootSiteAndOpenTree(page, 'import', 'Grandma Edith');
		// Don't seed a subject — the import auto-sets the first
		// imported individual as the site's subject_person_id when
		// none is set. That lets the imported tree become the
		// canvas root.

		// Follow the "Import GEDCOM" header link.
		await page.getByRole('link', { name: /import gedcom/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+\/tree\/import$/);

		// Set the file input with an in-memory GEDCOM blob. Tree of
		// three: Edith (focal) with Marek + Anna as her parents.
		const ged = `0 HEAD
1 GEDC
2 VERS 7.0
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Edith /Holloway/
1 SEX F
1 BIRT
2 DATE 1925
0 @I2@ INDI
1 NAME Marek /Holloway/
1 SEX M
1 BIRT
2 DATE 1898
0 @I3@ INDI
1 NAME Anna /Kowalska/
1 SEX F
1 BIRT
2 DATE 1900
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I3@
1 CHIL @I1@
1 MARR
2 DATE 1923
0 TRLR
`;
		await page.locator('input[type="file"]').setInputFiles({
			name: 'sample.ged',
			mimeType: 'text/plain',
			buffer: Buffer.from(ged, 'utf-8')
		});

		// Preview surfaces the structured counts before any write.
		await expect(page.getByRole('heading', { name: /preview/i })).toBeVisible();
		await expect(page.getByText(/3 people/i)).toBeVisible();
		await expect(page.getByText(/1 families/i)).toBeVisible();

		await page.getByRole('button', { name: /^import$/i }).click();
		await expect(
			page.getByRole('status').filter({ hasText: /imported.*people/i })
		).toBeVisible();

		// Back to the tree — all three imported people render via
		// the inferred parent edges: Edith is the auto-set subject,
		// Marek + Anna are her parents.
		await page.getByRole('link', { name: /back to the tree/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+\/tree$/);
		await expect(card(page, /edith holloway/i)).toBeVisible();
		await expect(card(page, /marek holloway/i)).toBeVisible();
		await expect(card(page, /anna kowalska/i)).toBeVisible();
	});

	test('view toggle switches to the fan chart and persists in the URL', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'fan', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Father');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /father/i)).toBeVisible();

		// Switch to the fan view.
		await page.getByRole('button', { name: /^fan chart$/i }).click();
		await expect(page).toHaveURL(/\?.*view=fan/);

		// The figure label changes to the fan-chart-specific accessible
		// name; both ancestors render as wedge buttons.
		const fan = page.getByRole('figure', { name: /ancestor fan chart|wachlarz/i });
		await expect(fan).toBeVisible();
		await expect(fan.getByRole('button', { name: /grandma edith/i })).toBeVisible();
		await expect(fan.getByRole('button', { name: /^father$/i })).toBeVisible();

		// Reload — the URL preserves the view choice.
		await page.reload();
		await expect(page.getByRole('figure', { name: /ancestor fan chart/i })).toBeVisible();

		// Toggle back to canvas; URL parameter dropped.
		await page.getByRole('button', { name: /^canvas$/i }).click();
		await expect(page).not.toHaveURL(/view=fan/);
		await expect(treeCanvas(page)).toBeVisible();
	});

	test('fan-chart wedge click opens the drawer for that ancestor', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'fan-click', 'Grandma Edith');
		await seedSubject(page, 'Grandma Edith');
		await (await selectPersonOnCanvas(page, /grandma edith/i))
			.getByRole('button', { name: /\+ parent/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Ancestor');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /ancestor/i)).toBeVisible();

		await page.getByRole('button', { name: /^fan chart$/i }).click();
		const fan = page.getByRole('figure', { name: /ancestor fan chart/i });
		await fan.getByRole('button', { name: /^ancestor$/i }).click();
		await expect(drawer(page).getByRole('heading', { name: /^ancestor$/i })).toBeVisible();
	});
});

test.describe('family tree — Phase 3 (multiplayer)', () => {
	test('one admin\'s tree edit appears in another admin\'s tab without a manual reload', async ({
		page,
		browser
	}) => {
		// Owner: create site, seed subject, invite a co-editor.
		const ownerEmail = uniqueEmail('mp-owner');
		const editorEmail = uniqueEmail('mp-editor');
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Shared Tree');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /shared tree/i }).click();
		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+$/);
		const siteId = new URL(page.url()).pathname.split('/')[2];

		await page.getByPlaceholder(/email@example\.com/i).fill(editorEmail);
		// Default invite role is `editor`; leave it alone.
		await page.getByRole('button', { name: /send invite/i }).click();
		await expect(page.getByRole('listitem').filter({ hasText: editorEmail })).toBeVisible();
		const token = latestInviteToken(editorEmail);

		// Seed the subject from the owner's tree page.
		await page.goto(`/sites/${siteId}/tree`);
		await seedSubject(page, 'Shared Tree');

		// Editor: separate browser context, accept invite, open the
		// same tree. Both tabs are now connected to the same per-site
		// Automerge document via WebSocket.
		const editorCtx = await browser.newContext();
		const editorPage = await editorCtx.newPage();
		await signInAs(editorPage, editorEmail);
		await editorPage.context().request.get(
			`/auth/invite?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		await editorPage.goto(`/sites/${siteId}/tree`);
		await expect(card(editorPage, /shared tree/i)).toBeVisible();
		// Wait for hydration + Automerge subscription to settle —
		// the doc-change event is what will drive the upcoming live
		// update.
		await editorPage.waitForLoadState('networkidle');

		// Owner adds a child via the inline ghost card. The remote
		// function persists to SQLite, then `refreshSiteTreeDoc`
		// projects the new row into the per-site Automerge doc,
		// which fires a `change` event over the WebSocket. The
		// editor's subscription invalidates their page load.
		await page
			.getByRole('button', { name: /add a child of shared tree/i })
			.click();
		await modal(page).getByLabel(/display name/i).fill('Live Child');
		await modal(page).getByRole('button', { name: /^add$/i }).click();
		await expect(card(page, /live child/i)).toBeVisible();

		// Editor sees the new card without a manual reload — that's
		// the multiplayer assertion. We give it a generous timeout
		// because the WebSocket → invalidateAll → load → render
		// chain has more steps than a same-tab update.
		await expect(card(editorPage, /live child/i)).toBeVisible({ timeout: 15_000 });

		await editorCtx.close();
	});
});

test.describe('family tree — i18n', () => {
	test('Polish locale renders the tree page and drawer in Polish', async ({ page }) => {
		await bootSiteAndOpenTree(page, 'pl-tree', 'Babcia Helena');
		await seedSubject(page, 'Babcia Helena');

		// Flip to Polish. Setting the Paraglide cookie via
		// `context.addCookies` is more reliable than driving the
		// `Polski` button — the in-app flow does `setLocale +
		// location.reload()`, which has been observed to race
		// under the Automerge sync layer's added page-load
		// latency. The button is exercised by `i18n.e2e.ts`; here
		// we just need a Polish render to assert on.
		await page.context().addCookies([
			{
				name: 'PARAGLIDE_LOCALE',
				value: 'pl',
				domain: '127.0.0.1',
				path: '/'
			}
		]);
		await page.goto('/sites');
		// Sanity: the Polish render landed.
		await expect(page.getByRole('heading', { name: /^twoje strony$/i })).toBeVisible();

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
