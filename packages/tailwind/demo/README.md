# demo

this directory contains a demo of the `scrollview-fade` plugin

## building

first, build the plugin:

```bash
pnpm build
pnpm build:demo
open dist.html
```

This will generate `dist.html` which you can open in your browser.

## Files

- `index.html` - The demo HTML template
- `input.css` - Tailwind CSS input with the plugin
- `build.mjs` - Build script that processes CSS with PostCSS and Tailwind
- `dist.html` - Generated output (gitignored)
