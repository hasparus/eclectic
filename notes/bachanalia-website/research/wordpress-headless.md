# Headless WordPress + Next.js on Vercel (2025–2026 state)

Researched 2026-07-02.

## Data layer options

- **WPGraphQL** — now a **canonical WordPress.org community plugin**
  (creator Jason Bahl moved from WP Engine to Automattic in Oct 2024;
  <https://wordpress.org/news/2024/10/wpgraphql/>). Actively maintained:
  v2.0 Feb 2025, monorepo migration Jan 2026, v2.12.x releases in 2026.
  Single request for nested data, typed schema → TS codegen,
  WPGraphQL Smart Cache available. The mainstream choice.
- **WP REST API** — core, zero plugins, always maintained. Over-fetching
  and N+1 for related content; fine for flat blog-shaped data.
  ACF exposes fields with per-field-group "Show in REST API" toggle.
- **Faust.js** (WP Engine) — still maintained (plugin releases through
  June 2026) but mid-rearchitecture: July 2025 RFC proposes rewriting it as
  a multi-framework adapter over the new "HWP Toolkit"
  (<https://github.com/wpengine/faustjs/discussions/2140>). Convenient
  (previews, template hierarchy) but couples you to a toolkit in transition.
  Skip.

Verdict for a small content site: WPGraphQL + WPGraphQL for ACF.

## Rendering/caching on Vercel

Consensus pattern (= Vercel's official template):

- SSG + **tag-based ISR**: tag all WP fetches (e.g. `wordpress`), cache
  indefinitely.
- **On-demand revalidation**: WP fires a webhook on publish/edit →
  Next.js `/api/revalidate` route → `revalidateTag('wordpress')`. Options:
  - [On-Demand Revalidation plugin](https://wordpress.org/plugins/on-demand-revalidation/)
    (ships a ready route.ts snippet, secret-key auth)
  - [superhuit-agency/nextjs-revalidate](https://github.com/superhuit-agency/nextjs-revalidate)
  - or a ~20-line `transition_post_status` mu-plugin (what Vercel's example does)
- **Draft preview**: Next.js Draft Mode + WP application passwords
  (+ WPGraphQL JWT auth in the Vercel example); drafts routed to
  `/preview/{id}` since they lack real slugs.
- Optional WP-side speedup: Redis object cache / WPGraphQL Smart Cache.

## WordPress as editor-only backend

- Keep existing WP hosting; only the API needs to be reachable from Vercel.
  Standard setup: WP on `wp.`/`admin.` subdomain, Next.js on the apex.
- Hide the WP frontend: "Headless Mode" plugin (404s frontend, keeps
  wp-admin + REST + `/graphql`) or a `template_redirect` 301 snippet.
- **Permalinks must be "Post name"** — pretty permalinks are required for
  URI resolution (called out in Vercel's template README).
- Media: keep WP media library, add the WP host to `images.remotePatterns`
  (restrict to `/wp-content/uploads/**`), let Vercel image optimization
  handle formats/sizes. Offloading to S3/Cloudinary only if WP host is slow.

## Gotchas

- **CORS**: non-issue if all WP fetching happens in server components /
  route handlers. Only browser-side calls to WP need CORS headers.
- **ACF**: fields are opt-in per field group ("Show in GraphQL" via
  WPGraphQL for ACF / "Show in REST API"). Forgetting the toggle is the
  classic missing-field bug. CPTs need `show_in_graphql`/`show_in_rest`.
- **i18n**: Polylang + wp-graphql-polylang works; WPML is painful headless.
  (Irrelevant for us — Polish only.)
- **Forms**: no WP frontend rendering anymore. Either POST to CF7's REST
  endpoint (`/wp-json/contact-form-7/v1/contact-forms/{id}/feedback`) from
  a server action, or skip WP and use a plain server action + email service
  — usually the pragmatic choice for one or two forms.
- **SEO**: Yoast exposes `yoast_head_json` (REST) / wp-graphql-yoast-seo
  (GraphQL) → map into the Next.js Metadata API. Yoast emits canonical/og
  URLs pointing at the WP domain — rewrite to the frontend domain. Generate
  sitemap/robots in Next.js.

## Templates worth cribbing

- **[vercel/next.js `examples/cms-wordpress`](https://github.com/vercel/next.js/tree/canary/examples/cms-wordpress)**
  ("ISR Blog with Next.js and WordPress" template) — App Router, WPGraphQL,
  tag-based revalidation, Draft Mode, Yoast metadata, TS codegen. **Start here.**
- [9d8dev/next-wp](https://github.com/9d8dev/next-wp) — REST-based, Next 16 /
  React 19, shadcn/ui; the reference if we ditch GraphQL.
- [10up/HeadstartWP](https://github.com/10up/headstartwp) — full REST
  framework, previews, revalidation plugin, Polylang.
- [gregrickaby/nextjs-wordpress](https://github.com/gregrickaby/nextjs-wordpress) —
  community WPGraphQL + App Router example with good WP-side setup docs.
