/// <reference types="node" />p
import { it, expect } from "vitest";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "../test/matchers.js";

const html = String.raw;
const css = String.raw;

async function run(document: string) {
  const currentTestName = expect.getState().currentTestName;

  const pluginPath = new URL("../dist/scrollview-fade.js", import.meta.url)
    .pathname;
  const cssPath = new URL("./scrollview-fade.spec.css", import.meta.url)
    .pathname;

  const sandboxDir = await mkdtemp(
    join(tmpdir(), `tailwind-${currentTestName!.replace(/\s+/g, "-")}`)
  );

  const documentPath = join(sandboxDir, "document.html");

  const inputCss = [
    `@source "${documentPath}";`,
    `@plugin "${pluginPath}";`,
    "@tailwind utilities;",
    "",
  ].join("\n");

  try {
    await writeFile(documentPath, document, "utf8");

    const result = await postcss([tailwindcss({})]).process(inputCss, {
      from: cssPath,
    });

    return result.css;
  } finally {
    await rm(sandboxDir, { recursive: true, force: true });
  }
}

it("generates base .scrollview-fade utility", async () => {
  const result = await run(html`<div class="scrollview-fade"></div>`);

  await expect(result).toIncludeCss(css`
    @layer base {
      @property --fade-start-opacity {
        syntax: "<number>";
        initial-value: 1;
        inherits: false;
      }
      @property --fade-end-opacity {
        syntax: "<number>";
        initial-value: 1;
        inherits: false;
      }
    }
  `);

  await expect(result).toIncludeCss(css`
    @keyframes scrollview-fade-start {
      from {
        --fade-start-opacity: 1;
      }
      to {
        --fade-start-opacity: 0;
      }
    }
    @keyframes scrollview-fade-end {
      from {
        --fade-end-opacity: 0;
      }
      to {
        --fade-end-opacity: 1;
      }
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade {
      position: relative;
      scroll-timeline: --scroll-timeline var(--fade-axis);
      --fade-start-opacity: 1;
      --fade-end-opacity: 1;
      mask-image: linear-gradient(
        var(--fade-angle),
        hsl(0 0% 0% / var(--fade-start-opacity)),
        black var(--fade-size-start),
        black calc(100% - var(--fade-size-end)),
        hsl(0 0% 0% / var(--fade-end-opacity))
      );
      -webkit-mask-image: linear-gradient(
        var(--fade-angle),
        hsl(0 0% 0% / var(--fade-start-opacity)),
        black var(--fade-size-start),
        black calc(100% - var(--fade-size-end)),
        hsl(0 0% 0% / var(--fade-end-opacity))
      );
      animation:
        scrollview-fade-start 10s ease-out both,
        scrollview-fade-end 10s ease-out both;
      animation-timeline: --scroll-timeline, --scroll-timeline;
      animation-range:
        0 2em,
        calc(100% - 2em) 100%;
    }
  `);
});

it("generates scrollview-fade-x utilities with spacing scale", async () => {
  const result = await run(html`
    <div class="scrollview-fade-x-4"></div>
    <div class="scrollview-fade-x-8"></div>
    <div class="scrollview-fade-x-16"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-x-4 {
      --fade-angle: 90deg;
      --fade-size-start: 1rem;
      --fade-size-end: 1rem;
      --fade-axis: x;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-x-8 {
      --fade-angle: 90deg;
      --fade-size-start: 2rem;
      --fade-size-end: 2rem;
      --fade-axis: x;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-x-16 {
      --fade-angle: 90deg;
      --fade-size-start: 4rem;
      --fade-size-end: 4rem;
      --fade-axis: x;
    }
  `);
});

it("generates scrollview-fade-y utilities with spacing scale", async () => {
  const result = await run(html`
    <div class="scrollview-fade-y-4"></div>
    <div class="scrollview-fade-y-8"></div>
    <div class="scrollview-fade-y-12"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-y-4 {
      --fade-angle: 180deg;
      --fade-size-start: 1rem;
      --fade-size-end: 1rem;
      --fade-axis: y;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-y-8 {
      --fade-angle: 180deg;
      --fade-size-start: 2rem;
      --fade-size-end: 2rem;
      --fade-axis: y;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-y-12 {
      --fade-angle: 180deg;
      --fade-size-start: 3rem;
      --fade-size-end: 3rem;
      --fade-axis: y;
    }
  `);
});

it("supports arbitrary values", async () => {
  const result = await run(html`
    <div class="scrollview-fade-x-[32px]"></div>
    <div class="scrollview-fade-y-[10%]"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-x-\[32px\] {
      --fade-angle: 90deg;
      --fade-size-start: 32px;
      --fade-size-end: 32px;
      --fade-axis: x;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-y-\[10\%\] {
      --fade-angle: 180deg;
      --fade-size-start: 10%;
      --fade-size-end: 10%;
      --fade-axis: y;
    }
  `);
});

it("generates scrollview-fade-left utilities", async () => {
  const result = await run(html`
    <div class="scrollview-fade-left-4"></div>
    <div class="scrollview-fade-left-8"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-left-4 {
      --fade-angle: 90deg;
      --fade-size-start: 1rem;
      --fade-axis: x;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-left-8 {
      --fade-angle: 90deg;
      --fade-size-start: 2rem;
      --fade-axis: x;
    }
  `);
});

it("generates scrollview-fade-right utilities", async () => {
  const result = await run(html`
    <div class="scrollview-fade-right-4"></div>
    <div class="scrollview-fade-right-8"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-right-4 {
      --fade-angle: 90deg;
      --fade-size-end: 1rem;
      --fade-axis: x;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-right-8 {
      --fade-angle: 90deg;
      --fade-size-end: 2rem;
      --fade-axis: x;
    }
  `);
});

it("generates scrollview-fade-top utilities", async () => {
  const result = await run(html`
    <div class="scrollview-fade-top-4"></div>
    <div class="scrollview-fade-top-8"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-top-4 {
      --fade-angle: 180deg;
      --fade-size-start: 1rem;
      --fade-axis: y;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-top-8 {
      --fade-angle: 180deg;
      --fade-size-start: 2rem;
      --fade-axis: y;
    }
  `);
});

it("generates scrollview-fade-bottom utilities", async () => {
  const result = await run(html`
    <div class="scrollview-fade-bottom-4"></div>
    <div class="scrollview-fade-bottom-8"></div>
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-bottom-4 {
      --fade-angle: 180deg;
      --fade-size-end: 1rem;
      --fade-axis: y;
    }
  `);

  await expect(result).toIncludeCss(css`
    .scrollview-fade-bottom-8 {
      --fade-angle: 180deg;
      --fade-size-end: 2rem;
      --fade-axis: y;
    }
  `);
});
