import { test, expect } from '@playwright/test';
import { safeGoto, signInAs, signOut, uniqueEmail } from './helpers/auth';
import { latestInviteToken } from './helpers/db';

test.describe('member invitations', () => {
	test('owner can invite an editor and the invitee can accept', async ({ page }) => {
		const ownerEmail = uniqueEmail('owner');
		const inviteeEmail = uniqueEmail('invitee');

		// Owner signs in and creates a site, then follows the new link
		// from the listing to land on the member-management page.
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Family memorial');
		await page.getByRole('button', { name: /create memorial/i }).click();
		await page.getByRole('link', { name: /family memorial/i }).click();
		await expect(page.getByRole('heading', { name: /family memorial/i })).toBeVisible();

		// Send an invite. The "Invite sent to …" toast is ephemeral
		// (cleared on the next page invalidation), so we assert on the
		// pending-invites list instead — that's the data-driven contract.
		await page.getByPlaceholder(/email@example\.com/i).fill(inviteeEmail);
		await page.getByRole('button', { name: /send invite/i }).click();

		const pending = page.getByRole('heading', { name: /pending invites/i });
		await expect(pending).toBeVisible();
		// The email shows in both the "Invite sent to …" toast and the
		// pending list row; the listitem is the data-driven one.
		await expect(
			page.getByRole('listitem').filter({ hasText: inviteeEmail })
		).toBeVisible();

		// Owner signs out.
		await signOut(page);

		// Invitee signs in (as themselves) and accepts. /auth/invite
		// returns 303 → /sites/[id]; consume via APIRequestContext (which
		// shares cookies with the page context) to avoid chromium
		// aborting the redirect chain, then navigate to the destination.
		await signInAs(page, inviteeEmail);
		const token = latestInviteToken(inviteeEmail);
		const acceptResponse = await page.context().request.get(
			`/auth/invite?token=${encodeURIComponent(token)}`,
			{ maxRedirects: 0 }
		);
		expect(acceptResponse.status()).toBe(303);
		const dest = acceptResponse.headers()['location'];
		await safeGoto(page, dest);

		await expect(page).toHaveURL(/\/sites\/[a-z0-9]+/);
		await expect(page.getByRole('heading', { name: /family memorial/i })).toBeVisible();

		// The members list now includes them as editor.
		await expect(page.getByText(/editor · you/i)).toBeVisible();
	});

	test('an invite for a different email is rejected when accepted', async ({ page }) => {
		const ownerEmail = uniqueEmail('owner2');
		const intendedEmail = uniqueEmail('intended');
		const wrongEmail = uniqueEmail('wrong');

		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Locked memorial');
		await page.getByRole('button', { name: /create memorial/i }).click();
		await page.getByRole('link', { name: /locked memorial/i }).click();
		await expect(page.getByRole('heading', { name: /locked memorial/i })).toBeVisible();
		await page.getByPlaceholder(/email@example\.com/i).fill(intendedEmail);
		await page.getByRole('button', { name: /send invite/i }).click();
		await expect(
			page.getByRole('listitem').filter({ hasText: intendedEmail })
		).toBeVisible();

		await signOut(page);

		// The wrong person tries to use the invite link. /auth/invite
		// renders an error page (200) in this case — safeGoto guards
		// against transient ERR_ABORTED from a racing in-flight request.
		await signInAs(page, wrongEmail);
		const token = latestInviteToken(intendedEmail);
		await safeGoto(page, `/auth/invite?token=${encodeURIComponent(token)}`);

		await expect(page.getByRole('heading', { name: /couldn't accept invite/i })).toBeVisible();
		await expect(page.getByText(/different email address/i)).toBeVisible();
	});

	test('owner can revoke a pending invite', async ({ page }) => {
		const ownerEmail = uniqueEmail('revoker');
		const inviteeEmail = uniqueEmail('revoked');

		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Revoke memorial');
		await page.getByRole('button', { name: /create memorial/i }).click();
		await page.getByRole('link', { name: /revoke memorial/i }).click();
		await expect(page.getByRole('heading', { name: /revoke memorial/i })).toBeVisible();

		await page.getByPlaceholder(/email@example\.com/i).fill(inviteeEmail);
		await page.getByRole('button', { name: /send invite/i }).click();

		const inviteRow = page.getByRole('listitem').filter({ hasText: inviteeEmail });
		await expect(inviteRow).toBeVisible();

		// invalidateAll() re-runs the page load and re-mounts; let the
		// hydration settle so the revoke button's handler is wired up.
		await page.waitForLoadState('networkidle');

		await inviteRow.getByRole('button', { name: /revoke/i }).click();

		await expect(inviteRow).toHaveCount(0);
	});
});
