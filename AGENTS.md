# Agent instructions for eclectic

Preserve other workspace packages. Paidotopos is at `packages/paidotopos`; install dependencies from this repository's root with Bun (`bun add --cwd packages/paidotopos <dependency>`), never create a nested lockfile. Read the actual package sources before editing. These playground rules apply to all paidotopos work.

## Create a prototype, from request to PR

1. Work on a branch. Read this file and `packages/paidotopos/README.md` first.
2. Create `packages/paidotopos/app/prototypes/<kebab-case-slug>/` with `page.tsx`, `metadata.json`, and `HOW_IT_WORKS.md`. Build discovery registers it automatically; do not edit `lib/registry.generated.ts` by hand. Direct private URLs use the folder route; `/p/<slug>` imports the same page from the generated registry.
3. Keep the prototype private unless the owner explicitly asks to publish that specific prototype. Never infer publication permission from a request to build, push, or deploy the playground.
4. Follow every non-negotiable rule below. Read actual shared component source before assuming a prop exists.
5. Capture light/dark thumbnails (`bun run --cwd packages/paidotopos thumbnails <slug>`), inspect them, and commit them with the implementation. Before explicitly approved public publication, capture `--video` while private, then set `public: true`. Public metadata must include OG image AND OG video; verify both respond without authentication. Do not leak private names through public errors or media routes.
6. Run lint, typecheck, tests, and a production build in paidotopos. Check 375px touch layout, light/dark themes, storage failure, actual animation computed styles, password boundary, and unknown/private public slug 404s.
7. Commit, push the branch, and open a pull request. The PR must run the build check and the connected host's preview deployment. End every task with the actual preview URL so the owner can open it on a phone. If hosting isn't connected, report that blocker; never invent a preview URL or call the PR URL a preview.
8. Keep HOW_IT_WORKS current, bump updatedAt, regenerate affected previews, and add any failure/fix lesson here before finishing.

## Non-negotiable prototype rules

### Metadata

Every prototype has this complete `metadata.json` shape:

```json
{
  "title": "My Prototype",
  "description": "What it does",
  "tags": ["tag1"],
  "createdAt": "YYYY-MM-DD",
  "updatedAt": "ISO timestamp",
  "hidden": false,
  "public": false
}
```

Bump `updatedAt` on every edit. Gallery sorts newest first. `hidden` is only a gallery filter; it is not access control. Missing previews must show “No preview yet”, never fail a private prototype's build.

### Documentation

Every prototype has a `HOW_IT_WORKS.md`, updated on every change, with:

- **What It Does**: 1–2 sentences.
- **Architecture**: ASCII data-flow diagram.
- **Frontend / API**: state, shortcuts, responsive behavior, request/response bullet points.
- **AI Usage**: if any model is called, exact model ID, why it was chosen, invocation path, key parameters, system prompt summary, and user prompt shape. Otherwise say none.
- **Key Dependencies**, **Component Tree**, **Error Handling**, **File Structure**.

### Self-contained and decomposed

Each prototype lives entirely in its folder and never imports another prototype. A necessary server API goes under `app/api/<slug>/`, with logic in the prototype folder; document it. Shared design-system and control components are allowed. Never write a giant file: keep page.tsx thin (~60 lines), with shared types in types.ts, mock data/constants/config in data.ts, testable pure logic in search.ts/utils.ts or descriptive files, and one file per meaningful UI component.

### Design system

Always use shared components and tokens: bg-background, text-foreground, bg-card, bg-muted, text-muted-foreground, bg-primary, border-border, etc. Never hardcode prototype colors (bg-black, hex values, inline color styles). Define actual palette values only in the global token stylesheet. Check actual component source before assuming props; upstream versions differ.

### Clean and minimal by default

Start with a centered `max-w-2xl mx-auto` column. No sidebars, split panels, tab-heavy layouts, dashboards, charts, extra views, or features unless requested; the required parameter panel is the explicit exception. Every element must justify itself. Plain badges, no decorative icons. Keep interface copy minimal; remove captions that repeat labels and unnecessary hints. Never build a new-prototype button or create API: coding agents create prototypes.

### Control panels

Put tunable parameters in a control panel, never scattered inputs. Reuse `components/control-panel.tsx`: schema generates controls, namespaced persistence, Reset, and Randomize (“surprise me”). Every panel must include both Reset and Randomize. Desktop panel sits beside the subject without covering it; mobile uses a bottom sheet.

### Mobile first

Everything must work at ~375px. Tap targets >=44×44px. Icon-only buttons on mobile with accessible names, labels from sm: up. No hover-only behavior: provide a visible touch equivalent. Code blocks wrap without horizontal scrolling. Modals with multiple items need visible prev/next or swipe on mobile, never keyboard-only navigation. Respect safe areas.

### Light and dark

Design dark-first and verify light mode through tokens. Never hardcode a dark class on a page. Global next-themes owns the theme. Use useTheme/resolvedTheme only when behavior needs it (e.g. canvas/WebGL), not to switch CSS colors. Gallery uses two static images switched by CSS, never JS and never live iframes. Default to dark when a system preference isn't available; honor system preference.

### Motion

Animate height open/closed for user-added/removed rows and sections; never make the page jump. Use smooth deceleration, no bouncy overshoot. Respect prefers-reduced-motion. Check computed styles to prove animations run: utility classes silently fail when CSS isn't imported. `tw-animate-css` is imported globally; accordion height keyframes are defined there.

### AI-backed prototypes

Call models server-side through API routes only, never expose keys. For model-generated UI/layout, put explicit layout constraints in the system prompt (maximum columns, no wide tables). Defensive CSS is backup, not a substitute. Parse JSON defensively by extracting the first {...} block and validating it. Wrap every API route in try/catch and return appropriate status codes.

### Storage

Wrap ALL localStorage access in try/catch, load on mount rather than server render, and namespace keys per prototype (`paidotopos:<slug>:...`). Invalid or unavailable storage must fall back gracefully.

### Thumbnails and sharing

New prototype or any visual change: regenerate its light and dark static previews in the same commit. Global style changes: regenerate all. Inspect captures before committing: a stale thumbnail is worse than none. Capture supports one slug, several space/comma-separated slugs, or --missing. Explicitly public prototypes ALWAYS need OG image and MP4 OG video; run --video and verify metadata and validated public media endpoints. Unknown/private public slugs and media return 404, never login redirects.

## Workflow rules

- Work on a branch, push, open a PR; check build and automatic preview deployment.
- End every task with the actual preview link, or a precise hosting blocker if unavailable.
- Before finishing, run lint, type-check, tests appropriate to the change, and a production build.
- When something fails and is fixed, record the lesson here.
- Add libraries only as needed: three/R3F (3D), Rapier/Matter (physics), Recharts/SVG (charts), MapLibre (maps), @chenglou/pretext (text), Web Audio/Tone (audio), provider SDK (server AI), json-render (JSON UI), Playwright (captures), Capacitor (native graduation). Install from repository root in this workspace.

## Lessons

- shadcn's registry currently emits a resizable component using PanelGroup/PanelResizeHandle. Pin react-resizable-panels to 2.1.9 until migrating the component to a newer API. Type-check every installed component, including unused ones.
- Create app/globals.css before installing the complete shadcn registry; otherwise the CLI installs files but exits before adding required animation CSS.
- Loading persistent state on mount is an intentional hydration boundary. Keep any lint exception local and justified, not disabled across the app.

- Use webpack for production builds in restricted environments: Turbopack may fail binding a helper port.
- Playwright video needs its own ffmpeg binary (`bunx playwright install chromium ffmpeg`) even if system ffmpeg is installed.
