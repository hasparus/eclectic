# Implementation Plan: Kajet (BlockNote + Y.js + SQLite)

## Phase 1: Foundations
*   [ ] **Scaffold**: Setup monorepo structure (`packages/client`, `packages/worker`).
    *   Client: Vite + React + TypeScript + EffectTS + TanStack Router.
    *   Worker: Wrangler + Durable Objects + SQLite.
*   [ ] **Routing**: TanStack Router setup (`/doc/$docId`).
*   [ ] **Styles**: Tailwind CSS setup.

## Phase 2: The Editor (Frontend)
*   [ ] **BlockNote Setup**:
    *   Install `@blocknote/core`, `@blocknote/react`.
    *   Create `<Editor />` component.
    *   Configure default schema (Paragraph, Heading, List, etc.).
*   [ ] **Customization UI**:
    *   Create settings panel.
    *   Implement font loading logic.
    *   Connect UI to a local React state (mocking Y.js for now).

## Phase 3: The Cloud Sync (Backend)
*   [ ] **Worker Setup**: `wrangler.toml` with `sqlite_state_backend = true`.
*   [ ] **Y.js Server (Durable Object)**:
    *   Initialize SQLite DB (`CREATE TABLE IF NOT EXISTS...`).
    *   Implement `fetch` handler to accept WebSocket upgrades.
    *   **Load**: Read blobs from SQLite -> `Y.applyUpdate`.
    *   **Save**: On WS update message -> `INSERT INTO updates...`.
    *   **Broadcast**: Relay updates to connected WebSockets.
*   [ ] **Compaction (Optimization)**:
    *   Implement logic to squash updates when table gets too large.

## Phase 4: Integration
*   [ ] **Client Provider**:
    *   Create `Effect` service for Y.js connection (`RoomService`).
    *   Use `y-websocket` (or a custom lightweight adapter) to connect to the Worker.
*   [ ] **Binding**:
    *   Bind BlockNote to the Y.doc.
    *   Bind "Settings" UI to `yDoc.getMap('settings')`.

## Phase 5: Polish
*   [ ] **Presence UI**: Show list of active users.
*   [ ] **Offline Support**:
    *   Persist Y.js updates to `IndexedDB` (`y-indexeddb`) so the app works offline and syncs later.
*   [ ] **Optimizations**: Debounce storage writes in DO.

## Directory Structure
```
packages/kajet/
├── client/              # Frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   ├── routes/
│   │   ├── lib/
│   │   ├── main.tsx
│   └── package.json
├── worker/              # Backend (Cloudflare)
│   ├── src/
│   │   ├── SyncRoom.ts  # Durable Object (SQLite)
│   │   ├── worker.ts
│   └── wrangler.toml
└── package.json
```
