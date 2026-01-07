# @hasparus/tailwind

a small collection of Tailwind CSS plugins (like, literally one plugin rn)

## innstallation

```bash
bun add @hasparus/tailwind
```

## plugins

### scrollview-fade

Creates smooth fade effects at the edges of scrollable containers using CSS mask-image and scroll timeline.

#### usage

```html
<div class="scrollview-fade scrollview-fade-x-16 overflow-auto"></div>
<div class="scrollview-fade scrollview-fade-y-[4rem] overflow-scroll"></div>
```

#### setup

in Tailwind 3 or Tailwind 4 with JS config

```ts
// tailwind.config.ts
import { scrollviewFade } from "@hasparus/tailwind";

export default {
  // your Tailwind config
  plugins: [scrollviewFade],
};
```

in Tailwind 4 with CSS config

```css
@plugin "@hasparus/tailwind/scrollview-fade";
```

#### classes

Use

- **`.scrollview-fade`** - base class that applies the fade effect to a scrollable container

Then either of

- **`.scrollview-fade-x-{size}`** - sets horizontal fade size (e.g., `scrollview-fade-x-8`)
- **`.scrollview-fade-y-{size}`** - sets vertical fade size (e.g., `scrollview-fade-y-12`)

The `{size}` value can be any value from your Tailwind spacing scale or arbitrary length / percentage value.

## Browser Support

The scrollview-fade plugin requires browsers that support:

- CSS Scroll-driven Animations
- CSS `@property`
- CSS `mask-image`

This includes recent versions of Chrome/Edge (115+) and other Chromium-based browsers. Check [caniuse.com](https://caniuse.com/css-scroll-timeline) for current support.

As of October 2025, Firefox needs `layout.css.scroll-driven-animations.enabled` setting for scroll timeline, but as nicer scrollviews are a progressive enhancement, it's not a blocker. Alternatively, one can use [scroll-timeline polyfill](https://github.com/flackr/scroll-timeline).
