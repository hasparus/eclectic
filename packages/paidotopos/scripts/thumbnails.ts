import { chromium } from "@playwright/test";
import { mkdir, readdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSession, COOKIE } from "../lib/auth";
const args = process.argv.slice(2),
  flags = new Set(["--missing", "--video", "--no-build"]);
const requested = args
  .filter((a) => !a.startsWith("--"))
  .flatMap((a) => a.split(","));
for (const arg of args)
  if (arg.startsWith("--") && !flags.has(arg))
    throw new Error(`Unknown flag ${arg}`);
const slugs = (await readdir("app/prototypes", { withFileTypes: true }))
  .filter((d) => d.isDirectory() && !d.name.startsWith("["))
  .map((d) => d.name);
for (const slug of requested)
  if (!slugs.includes(slug)) throw new Error(`Unknown prototype: ${slug}`);
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
let selected = requested.length ? requested : slugs;
if (args.includes("--missing")) {
  const missing = [];
  for (const slug of selected)
    if (
      !(await exists(`public/thumbnails/${slug}-light.png`)) ||
      !(await exists(`public/thumbnails/${slug}-dark.png`)) ||
      (args.includes("--video") && !(await exists(`public/social/${slug}.mp4`)))
    )
      missing.push(slug);
  selected = missing;
}
if (!selected.length) {
  console.log("All previews exist.");
  process.exit(0);
}
async function run(command: string, argv: string[]) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(command, argv, { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (c) =>
      c === 0 ? resolve() : reject(new Error(`${command} exited ${c}`)),
    );
  });
}
// Public metadata validation happens after captures so a first public video can be created.
if (!args.includes("--no-build")) await run("bun", ["run", "build"]);
const port = Number(process.env.CAPTURE_PORT || 3217),
  origin = `http://localhost:${port}`;
const secret = randomBytes(32).toString("hex");
const server = spawn("bun", ["run", "start", "--port", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    AUTH_SECRET: secret,
    PLAYGROUND_PASSWORD: randomBytes(32).toString("hex"),
  },
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error("Capture server exited");
    try {
      const res = await fetch(origin + "/login");
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Capture server did not become ready");
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  await mkdir("public/thumbnails", { recursive: true });
  await mkdir("public/social", { recursive: true });
  for (const slug of selected) {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      await context.addCookies([
        {
          name: COOKIE,
          value: await createSession(secret),
          url: origin,
          secure: false,
        },
      ]);
      await context.addInitScript(
        (t) => localStorage.setItem("theme", t),
        theme,
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const res = await page.goto(`${origin}/prototypes/${slug}`, {
        waitUntil: "networkidle",
      });
      if (!res?.ok())
        throw new Error(`Capture failed: ${slug} (${res?.status()})`);
      await page.evaluate(() => document.fonts.ready);
      if (errors.length) throw new Error(errors.join("\n"));
      await page.screenshot({ path: `public/thumbnails/${slug}-${theme}.png` });
      await context.close();
    }
    if (args.includes("--video")) {
      // Capture a real interaction at 30fps, then encode a broadly compatible MP4.
      const context = await browser.newContext({
        viewport: { width: 1200, height: 800 },
        colorScheme: "dark",
        recordVideo: {
          dir: ".next/capture",
          size: { width: 1200, height: 800 },
        },
      });
      await context.addCookies([
        {
          name: COOKIE,
          value: await createSession(secret),
          url: origin,
          secure: false,
        },
      ]);
      await context.addInitScript(() => localStorage.setItem("theme", "dark"));
      const page = await context.newPage();
      await page.goto(`${origin}/prototypes/${slug}`, {
        waitUntil: "networkidle",
      });
      for (let i = 0; i < 3; i++) {
        const random = page.getByRole("button", {
          name: "Randomize",
          exact: true,
        });
        if (await random.isVisible()) await random.click();
        await page.waitForTimeout(1000);
      }
      const video = page.video();
      await context.close();
      if (!video) throw new Error("Video recording failed");
      await run("ffmpeg", [
        "-y",
        "-i",
        await video.path(),
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        `public/social/${slug}.mp4`,
      ]);
    }
    console.log(`Captured ${slug}`);
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
await run("bun", ["scripts/registry.ts"]);
