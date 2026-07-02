# Ludamus (github.com/zagrajmy/ludamus)

Researched 2026-07-02 by reading the public repo (the live zagrajmy.net
instance was blocked from the research sandbox).

## What it is

Open-source (BSD-3) convention/game-session enrollment platform.
Server-rendered **Django ~6.0 monolith** (Python ≥3.14, Poetry), Vite +
Tailwind client assets, in-house "tessera" design system, PostgreSQL 16,
Auth0 for auth, Docker Compose + gunicorn behind nginx/Caddy on a VPS.
Live at zagrajmy.net with per-convention subdomains (e.g.
`kapitularz.zagrajmy.net`).

Architecture: "GLIMPSE" layering enforced by import-linter — gates
(views/CLI) → mills (services) → links (repositories) → pacts (pydantic
DTOs). Views never touch models; they call `request.services.*` and get DTOs
back. Key paths: models in `src/ludamus/adapters/db/django/models.py`,
public routes in `src/ludamus/adapters/web/django/urls.py`, web gates in
`src/ludamus/gates/web/django/{chronology,multiverse,mcp,notice_board}`.

## Domain model (relevant parts)

- **Sphere** = tenant (OneToOne with Django Site), resolved from hostname by
  middleware; unknown domains redirect to `ROOT_DOMAIN`. Feature flags via
  `enabled_pages`, sphere managers.
- **Event** (belongs to Sphere): publication + proposal windows, **Space**
  tree for venue (building→floor→room, capacity), **TimeSlot** with overlap
  validation, thematic **Track**.
- **Session** (game/panel/workshop: title, description, presenter,
  facilitators, participant limit, min age, status, soft delete) scheduled
  via **AgendaItem** (OneToOne Session ↔ Space + start/end).
- **Proposals**: ProposalCategory per event (windows, tags, durations,
  AUTO vs OFFER_CLAIM promotion), accept flow.
- **Enrollment**: SessionParticipation (CONFIRMED/WAITING/OFFERED),
  waitlist offer-and-claim with `claim_token` (login-free accept),
  EnrollmentConfig per event (windows, `percentage_slots` staged capacity
  release, per-user/per-email-domain overrides), anonymous enrollment flow.
- Extras: tags, custom questionnaires (SessionField, PersonalDataField),
  bans/shadowbans, notifications, announcements, discounts, notice-board
  meetups (Encounter/RSVP), EventIntegration for external ticketing with
  import audit log, organizer panel at `/panel/`, public print view of the
  programme, `/healthz/`.

## Integration surface (the important part)

- **No public REST/GraphQL API.** All public pages are server-rendered HTML
  (`/events/`, `/chronology/event/<slug>/`, `.../print/`).
- **`X-Frame-Options: DENY`** in production → no iframes.
- **No CORS headers** (no django-cors-headers) → no browser-side fetch from
  another origin.
- `/mcp/` JSON-RPC endpoint exists but is **superuser-only** (tokens minted
  at `/mcp/token/` by logged-in superusers, 30-day max) — not a public API.
- `links/ticket_api.py` is an *outbound* client to an external membership
  API, not a served endpoint.
- User auth = Auth0 + Django session cookies scoped per sphere domain, so
  user-context calls from an external origin aren't possible anyway.

### Consequences for the Bachanalia site

Only viable integration shapes:

1. **Upstream a public JSON programme feed** (recommended — we co-maintain
   ludamus). Thin new gate in `gates/web/django/chronology`, service in
   mills returning pydantic DTOs. Read-only, per event slug, cacheable.
2. Server-side scraping of the public event page (server-to-server ignores
   XFO/CORS) — fragile stopgap only.
3. Iframe — blocked. Direct DB — bad coupling. MCP — wrong auth model.

Enrollment/proposals must happen on the ludamus domain (session-cookie
auth), so the website deep-links into the sphere rather than embedding
flows. Needs a Bachanalia sphere (hostname-resolved, e.g.
`bachanalia.zagrajmy.net`).
