import { test, expect } from '@playwright/test';
import { signInAs, uniqueEmail } from './helpers/auth';

test.describe('qr codes', () => {
	test('owner can mint a short code and download its QR SVG', async ({ page }) => {
		const ownerEmail = uniqueEmail('qr-owner');

		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Marble plaque');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /marble plaque/i }).click();
		await expect(page.getByRole('heading', { name: /marble plaque/i })).toBeVisible();

		// Mint a fresh code; an <img> for it should appear in the
		// QR-codes list.
		await page.getByRole('button', { name: /generate qr code/i }).click();

		const qrImg = page.getByRole('img', { name: /qr code/i });
		await expect(qrImg).toBeVisible();

		// The image src is the QR endpoint for the new code.
		const src = await qrImg.getAttribute('src');
		expect(src).toMatch(/^\/sites\/[a-z0-9]+\/qr\/[A-Za-z0-9]+$/);

		// Fetch the SVG bytes via APIRequestContext so we can assert on
		// the content type and shape without rendering it again.
		const response = await page.context().request.get(src!);
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('image/svg+xml');
		const body = await response.text();
		expect(body).toMatch(/^<svg /);
		// Logo SVG is composited in by default.
		expect(body).toContain('<rect ');
	});

	test('owner can download a PDF for each preset size', async ({ page }) => {
		const ownerEmail = uniqueEmail('qr-pdf-owner');

		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Bronze plaque');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /bronze plaque/i }).click();
		await page.getByRole('button', { name: /generate qr code/i }).click();

		const qrImg = page.getByRole('img', { name: /qr code/i });
		await expect(qrImg).toBeVisible();
		const src = (await qrImg.getAttribute('src'))!;
		const sizes = ['card', 'plaque', 'headstone'] as const;

		// One labelled PDF link per preset; each should fetch a real
		// PDF with the correct Content-Disposition for a download.
		for (const size of sizes) {
			const link = page.getByRole('link', { name: new RegExp(`PDF · `) }).nth(sizes.indexOf(size));
			await expect(link).toBeVisible();
		}

		for (const size of sizes) {
			const pdfUrl = `${src}?format=pdf&size=${size}`;
			const response = await page.context().request.get(pdfUrl);
			expect(response.status()).toBe(200);
			expect(response.headers()['content-type']).toContain('application/pdf');
			expect(response.headers()['content-disposition']).toContain(`-${size}.pdf`);
			// PDF magic header — confirms the body actually is a PDF.
			const body = await response.body();
			expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
		}
	});

	test('rejects unknown preset size with a 400', async ({ page }) => {
		const ownerEmail = uniqueEmail('qr-bad-size');
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Whatever');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /whatever/i }).click();
		await page.getByRole('button', { name: /generate qr code/i }).click();

		const qrImg = page.getByRole('img', { name: /qr code/i });
		await expect(qrImg).toBeVisible();
		const src = (await qrImg.getAttribute('src'))!;
		const response = await page.context().request.get(`${src}?format=pdf&size=mega`);
		expect(response.status()).toBe(400);
	});

	test('a non-member cannot fetch a site QR even with a valid code', async ({ page }) => {
		const ownerEmail = uniqueEmail('qr-owner-private');
		const strangerEmail = uniqueEmail('qr-stranger');

		// Owner mints a code on their site.
		await signInAs(page, ownerEmail, '/sites');
		await page.getByPlaceholder(/display name/i).fill('Restricted memorial');
		await page.getByRole('button', { name: /create site/i }).click();
		await page.getByRole('link', { name: /restricted memorial/i }).click();
		await page.getByRole('button', { name: /generate qr code/i }).click();
		const qrImg = page.getByRole('img', { name: /qr code/i });
		await expect(qrImg).toBeVisible();
		const src = (await qrImg.getAttribute('src'))!;

		// Stranger signs in as themselves and tries the same URL.
		const { signOut } = await import('./helpers/auth.js');
		await signOut(page);
		await signInAs(page, strangerEmail);
		const response = await page.context().request.get(src);
		expect(response.status()).toBe(403);
	});
});
