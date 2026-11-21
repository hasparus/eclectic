# Orbit study

## What It Does
Draws a phyllotaxis pattern. Change particle count, rotation, and spacing, or discover a new arrangement with Randomize.

## Architecture
```text
Parameter schema → shared controls → React settings → makePattern → SVG circles
                          ↕
             namespaced localStorage
```

## Frontend / API
- React owns numeric settings. Pure math computes deterministic SVG positions.
- No API, model calls, network requests, or keyboard shortcuts.
- Native range inputs support arrow keys. All controls have labels and 44px touch areas.
- Desktop controls sit beside the subject; mobile uses a bottom sheet with a visible close button.
- The subject fits within 65svh so captures show the full drawing. SVG inherits theme tokens through currentColor. Theme changes need no JavaScript.
- Circle count changes are intentional drawing updates, not added interface rows. No added/removed sections.

## AI Usage
None.

## Key Dependencies
React, shared shadcn Button/Sheet, next-themes globally.

## Component Tree
```text
Page
└── OrbitStudy
    ├── PatternCanvas → SVG
    └── ControlPanel → desktop aside / mobile Sheet
```

## Error Handling
Storage reads/writes are caught; invalid persisted values fall back to defaults or clamp to bounds. Pure pattern logic caps count at 400. No remote failures.

## File Structure
- page.tsx: thin route
- orbit-study.tsx: state and composition
- pattern-canvas.tsx: SVG drawing
- pattern.ts: pure geometry
- types.ts: Settings and Dot
- data.ts: defaults and parameter schema
- metadata.json: gallery information; share alias disabled by default, direct page open
- HOW_IT_WORKS.md: this document
