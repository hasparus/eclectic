import { test, expect } from "@playwright/test";

test("production gate protects pages, API and media, public private names are 404", async ({
  request,
}) => {
  for (const path of [
    "/",
    "/prototypes/orbit-study",
    "/thumbnails/orbit-study-dark.png",
    "/social/orbit-study.mp4",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login");
  }
  for (const slug of ["orbit-study", "unknown-name"])
    for (const suffix of ["", "/preview/dark", "/preview/video"])
      expect((await request.get(`/p/${slug}${suffix}`)).status()).toBe(404);
  expect(
    (
      await request.post("/api/auth", {
        form: { password: "integration-test-password" },
      })
    ).status(),
  ).toBe(403);
  const wrong = await request.post("/api/auth", {
    headers: { origin: "http://localhost:3218" },
    form: { password: "wrong" },
    maxRedirects: 0,
  });
  expect(wrong.status()).toBe(303);
  expect(wrong.headers().location).toContain("error=1");
  const ok = await request.post("/api/auth", {
    headers: { origin: "http://localhost:3218" },
    form: { password: "integration-test-password", next: "//evil.test" },
    maxRedirects: 0,
  });
  expect(ok.status()).toBe(303);
  expect(ok.headers().location).toBe("http://localhost:3218/");
  expect(ok.headers()["set-cookie"]).toMatch(/HttpOnly/i);
  expect(ok.headers()["set-cookie"]).toMatch(/Secure/i);
});

for (const theme of ["dark", "light"] as const)
  test(`mobile gallery and controls in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: theme });
    // Authenticate via browser login; secure cookies work on localhost.
    await page.goto("/");
    await page
      .getByLabel("Password", { exact: true })
      .fill("integration-test-password");
    await page.getByRole("button", { name: "Enter playground" }).click();
    await expect(
      page.getByRole("heading", { name: "Small experiments." }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Search prototypes" })
      .fill("nothing matches");
    await expect(page.getByText("No experiments found.")).toBeVisible();
    await page.getByRole("textbox", { name: "Search prototypes" }).fill("");
    await expect(page.locator("iframe")).toHaveCount(0);
    await page
      .getByRole("link")
      .filter({ has: page.getByRole("heading", { name: "Orbit study" }) })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Parameters", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const animation = await dialog.evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    expect(animation).not.toBe("none");
    await dialog
      .getByRole("button", { name: "Randomize", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(dialog.getByRole("slider", { name: /Particles/ })).toHaveValue(
      "180",
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    expect(await page.locator("html").getAttribute("class")).toContain(theme);
  });
