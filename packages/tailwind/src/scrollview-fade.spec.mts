import { it, expect } from "vitest";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

import "../test/matchers.js";

const html = String.raw;
const css = String.raw;

async function run(input: string) {
  const inputCss = css`
    @plugin "${new URL("../dist/scrollview-fade.js", import.meta.url)
      .pathname}";
  `;

  const result = await postcss([tailwindcss({})]).process(inputCss, {
    document: html`<div class="prose"></div>`,
  });

  return result.css;
}

it.only("generates base .scrollview-fade utility", async () => {
  const result = await run(html`<div class="scrollview-fade"></div>`);

  expect(result).toIncludeCss(css`
    .scrollview-fade {
      position: relative;
      scroll-timeline: --scroll-timeline-x inline;
      --fade-start-opacity: 1;
      --fade-end-opacity: 1;
      mask-image: linear-gradient(
        var(--fade-angle),
        hsl(0 0% 0% / var(--fade-start-opacity)),
        black var(--fade-size),
        black calc(100% - var(--fade-size)),
        hsl(0 0% 0% / var(--fade-end-opacity))
      );
      -webkit-mask-image: linear-gradient(
        var(--fade-angle),
        hsl(0 0% 0% / var(--fade-start-opacity)),
        black var(--fade-size),
        black calc(100% - var(--fade-size)),
        hsl(0 0% 0% / var(--fade-end-opacity))
      );
      animation:
        scrollview-fade-start 10s ease-out both,
        scrollview-fade-end 10s ease-out both;
      animation-timeline: --scroll-timeline-x, --scroll-timeline-x;
      animation-range:
        0 2em,
        calc(100% - 2em) 100%;
    }
  `);

  expect(result).toIncludeCss(css`
    @keyframes scrollview-fade-start {
      from {
        --fade-start-opacity: 1;
      }
      to {
        --fade-start-opacity: 0;
      }
    }
  `);

  expect(result).toIncludeCss(css`
    @keyframes scrollview-fade-end {
      from {
        --fade-end-opacity: 0;
      }
      to {
        --fade-end-opacity: 1;
      }
    }
  `);

  expect(result).toIncludeCss(css`
    @property --fade-start-opacity {
      syntax: "<number>";
      initial-value: 1;
      inherits: false;
    }
  `);

  expect(result).toIncludeCss(css`
    @property --fade-end-opacity {
      syntax: "<number>";
      initial-value: 1;
      inherits: false;
    }
  `);
});

it("generates scrollview-fade-x utilities with spacing scale", async () => {
  const result = await run(html`
    <div class="scrollview-fade-x-4"></div>
    <div class="scrollview-fade-x-8"></div>
    <div class="scrollview-fade-x-16"></div>
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-x-4 {
      --fade-angle: 90deg;
      --fade-size: 1rem;
    }
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-x-8 {
      --fade-angle: 90deg;
      --fade-size: 2rem;
    }
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-x-16 {
      --fade-angle: 90deg;
      --fade-size: 4rem;
    }
  `);
});

it("generates scrollview-fade-y utilities with spacing scale", async () => {
  const result = await run(html`
    <div class="scrollview-fade-y-4"></div>
    <div class="scrollview-fade-y-8"></div>
    <div class="scrollview-fade-y-12"></div>
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-y-4 {
      --fade-angle: 180deg;
      --fade-size: 1rem;
    }
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-y-8 {
      --fade-angle: 180deg;
      --fade-size: 2rem;
    }
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-y-12 {
      --fade-angle: 180deg;
      --fade-size: 3rem;
    }
  `);
});

it("supports arbitrary values", async () => {
  const result = await run(html`
    <div class="scrollview-fade-x-[32px]"></div>
    <div class="scrollview-fade-y-[10%]"></div>
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-x-\[32px\] {
      --fade-angle: 90deg;
      --fade-size: 32px;
    }
  `);

  expect(result).toIncludeCss(css`
    .scrollview-fade-y-\[10\%\] {
      --fade-angle: 180deg;
      --fade-size: 10%;
    }
  `);
});
