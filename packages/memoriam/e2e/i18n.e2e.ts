import { test, expect } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers/auth';

test.describe('app UI translations', () => {
	test('user can switch the app UI to Polish and back', async ({ page }) => {
		const email = uniqueEmail('pl-switcher');
		await signInAs(page, email, '/sites');

		// English by default — the `baseLocale` from project.inlang/settings.json
		// is the strategy's last fallback (no cookie set yet).
		await expect(page.getByRole('heading', { name: /your sites/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /create site/i })).toBeVisible();

		// Click "Polski" — the LocaleSwitcher persists the choice via
		// the PARAGLIDE_LOCALE cookie and reloads, so the next render
		// comes back fully Polish.
		await page.getByRole('button', { name: 'Polski' }).click();
		await page.waitForLoadState('networkidle');

		await expect(page.getByRole('heading', { name: /twoje strony/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /stwórz stronę/i })).toBeVisible();
		// Empty-state copy is the sentinel for translated paragraph text.
		await expect(page.getByText(/nie masz jeszcze żadnych stron/i)).toBeVisible();

		// Cookie survives a fresh navigation — switching is sticky.
		await page.goto('/sites');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('heading', { name: /twoje strony/i })).toBeVisible();

		// Switch back to English; English copy returns.
		await page.getByRole('button', { name: 'English' }).click();
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('heading', { name: /your sites/i })).toBeVisible();
	});
});
