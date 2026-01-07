# Cloudflare Durable Object with SQLite and Y.js

```typescript
import { DurableObject } from "cloudflare:workers";

export class KajetRoom extends DurableObject {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
  }

  initializeSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        update_blob BLOB NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_vector BLOB NOT NULL,
        snapshot_blob BLOB NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
    `);
  }

  async fetch(request: Request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Expected WebSocket", { status: 426 });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return;

    // Parse Y.js message and store updates
    // this.sql.exec("INSERT INTO updates (update_blob) VALUES (?)", update);
    
    // Broadcast to other clients
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) {
        other.send(message);
      }
    }
  }
}
```

## Hibernation Pattern

With `hibernation: true`, use `ctx.acceptWebSocket(ws)` to hand off WebSocket lifecycle to the runtime.
