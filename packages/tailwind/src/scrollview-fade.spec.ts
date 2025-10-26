import { it, expect } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import scrollviewFadePlugin from "./scrollview-fade";
import "../test/matchers";

const html = String.raw;
const css = String.raw;

function run(config: any) {
  return postcss(
    tailwindcss({
      ...config,
      plugins: [scrollviewFadePlugin],
      corePlugins: { preflight: false },
    })
  ).process("@tailwind utilities;", { from: undefined });
}

it("generates base .scrollview-fade utility", async () => {
  const config = {
    content: [{ raw: html`<div class="scrollview-fade"></div>` }],
  };

  const result = await run(config);

  expect(result.css).toIncludeCss(css`
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
      animation-range: 0 2em, calc(100% - 2em) 100%;
    }
  `);

  expect(result.css).toIncludeCss(css`
    @keyframes scrollview-fade-start {
      from {
        --fade-start-opacity: 1;
      }
      to {
        --fade-start-opacity: 0;
      }
    }
  `);

  expect(result.css).toIncludeCss(css`
    @keyframes scrollview-fade-end {
      from {
        --fade-end-opacity: 0;
      }
      to {
        --fade-end-opacity: 1;
      }
    }
  `);

  expect(result.css).toIncludeCss(css`
    @property --fade-start-opacity {
      syntax: "<number>";
      initial-value: 1;
      inherits: false;
    }
  `);

  expect(result.css).toIncludeCss(css`
    @property --fade-end-opacity {
      syntax: "<number>";
      initial-value: 1;
      inherits: false;
    }
  `);
});

it("generates scrollview-fade-x utilities with spacing scale", async () => {
  const config = {
    content: [
      {
        raw: html`
          <div class="scrollview-fade-x-4"></div>
          <div class="scrollview-fade-x-8"></div>
          <div class="scrollview-fade-x-16"></div>
        `,
      },
    ],
  };

  const result = await run(config);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-x-4 {
      --fade-angle: 90deg;
      --fade-size: 1rem;
    }
  `);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-x-8 {
      --fade-angle: 90deg;
      --fade-size: 2rem;
    }
  `);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-x-16 {
      --fade-angle: 90deg;
      --fade-size: 4rem;
    }
  `);
});

it("generates scrollview-fade-y utilities with spacing scale", async () => {
  const config = {
    content: [
      {
        raw: html`
          <div class="scrollview-fade-y-4"></div>
          <div class="scrollview-fade-y-8"></div>
          <div class="scrollview-fade-y-12"></div>
        `,
      },
    ],
  };

  const result = await run(config);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-y-4 {
      --fade-angle: 180deg;
      --fade-size: 1rem;
    }
  `);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-y-8 {
      --fade-angle: 180deg;
      --fade-size: 2rem;
    }
  `);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-y-12 {
      --fade-angle: 180deg;
      --fade-size: 3rem;
    }
  `);
});

it("supports arbitrary values", async () => {
  const config = {
    content: [
      {
        raw: html`
          <div class="scrollview-fade-x-[32px]"></div>
          <div class="scrollview-fade-y-[10%]"></div>
        `,
      },
    ],
  };

  const result = await run(config);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-x-\[32px\] {
      --fade-angle: 90deg;
      --fade-size: 32px;
    }
  `);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-y-\[10\%\] {
      --fade-angle: 180deg;
      --fade-size: 10%;
    }
  `);
});

it("supports custom spacing theme values", async () => {
  const config = {
    content: [{ raw: html`<div class="scrollview-fade-x-custom"></div>` }],
    theme: {
      extend: {
        spacing: {
          custom: "42px",
        },
      },
    },
  };

  const result = await run(config);

  expect(result.css).toIncludeCss(css`
    .scrollview-fade-x-custom {
      --fade-angle: 90deg;
      --fade-size: 42px;
    }
  `);
});
});
