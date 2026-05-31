/**
 * Vite plugin: mount a WebSocket Automerge sync endpoint at
 * `/ws/automerge` on the dev server.
 *
 * Pattern: one `WebSocketServer` (no-server mode) is attached to
 * the Automerge `Repo` via a single `NodeWSServerAdapter`. The
 * adapter listens for `connection` events on the server and
 * handles each socket itself. Per-connection auth happens before
 * we delegate to the adapter — invalid sessions → 401/403 close.
 *
 * Server modules (`$lib/server/...`) are loaded through
 * `server.ssrLoadModule` so SvelteKit's path aliases resolve at
 * runtime — a plain Node dynamic import would fail at `$lib`.
 * We cache the resolved module after first load so the upgrade
 * path stays cheap.
 */

import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { parse as parseUrl } from 'node:url';
import { parse as parseCookie } from 'node:querystring';

const ENDPOINT = '/ws/automerge';

interface ServerModules {
	getAutomergeRepo: () => {
		networkSubsystem: { addNetworkAdapter: (a: unknown) => void };
	};
	ensureSiteTreeDoc: (siteId: string) => Promise<string>;
	getPlatformSession: (id: string) => { user_id: string; expires: number } | null;
	platformSessionCookieName: string;
	getSiteMember: (siteId: string, userId: string) => unknown;
	NodeWSServerAdapter: new (server: WebSocketServer) => unknown;
}

export function automergeSyncPlugin(): Plugin {
	return {
		name: 'memoriam-automerge-sync',
		configureServer(server) {
			let modulesPromise: Promise<ServerModules> | null = null;
			let wssAttached: WebSocketServer | null = null;

			const initOnce = async (): Promise<{ mods: ServerModules; wss: WebSocketServer }> => {
				if (modulesPromise && wssAttached) {
					const mods = await modulesPromise;
					return { mods, wss: wssAttached };
				}
				modulesPromise ??= (async () => {
					const [automerge, sessions, sites, wsAdapter] = await Promise.all([
						server.ssrLoadModule('/src/lib/server/automerge_server.ts'),
						server.ssrLoadModule('/src/lib/server/sessions.ts'),
						server.ssrLoadModule('/src/lib/server/sites.ts'),
						import('@automerge/automerge-repo-network-websocket')
					]);
					return {
						getAutomergeRepo: automerge.getAutomergeRepo,
						ensureSiteTreeDoc: automerge.ensureSiteTreeDoc,
						getPlatformSession: sessions.getPlatformSession,
						platformSessionCookieName: sessions.platformSessionCookieName,
						getSiteMember: sites.getSiteMember,
						NodeWSServerAdapter: wsAdapter.NodeWSServerAdapter
					} as ServerModules;
				})();
				const mods = await modulesPromise;
				if (!wssAttached) {
					wssAttached = new WebSocketServer({ noServer: true });
					// One adapter listens for all `connection` events on
					// this `wss` and creates per-peer subprotocols.
					mods.getAutomergeRepo().networkSubsystem.addNetworkAdapter(
						new mods.NodeWSServerAdapter(wssAttached)
					);
				}
				return { mods, wss: wssAttached };
			};

			server.httpServer?.on('upgrade', async (req: IncomingMessage, socket, head) => {
				const { pathname, query } = parseUrl(req.url ?? '', true);
				if (pathname !== ENDPOINT) return;

				const siteId = typeof query.site === 'string' ? query.site : null;
				if (!siteId) {
					socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
					socket.destroy();
					return;
				}

				let mods: ServerModules;
				let wss: WebSocketServer;
				try {
					({ mods, wss } = await initOnce());
				} catch (err) {
					console.error('[automerge] init failed', err);
					socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
					socket.destroy();
					return;
				}

				const userId = resolveUserFromCookies(
					req,
					mods.platformSessionCookieName,
					mods.getPlatformSession
				);
				if (!userId) {
					socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
					socket.destroy();
					return;
				}

				const member = mods.getSiteMember(siteId, userId);
				if (!member) {
					socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
					socket.destroy();
					return;
				}

				try {
					await mods.ensureSiteTreeDoc(siteId);
				} catch (err) {
					console.error('[automerge] failed to ensure site doc', siteId, err);
					socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
					socket.destroy();
					return;
				}

				wss.handleUpgrade(req, socket, head, (ws) => {
					// Hand off to the adapter via the server's
					// `connection` event — that's how `NodeWSServerAdapter`
					// picks up the new peer.
					wss.emit('connection', ws, req);
				});
			});
		}
	};
}

function resolveUserFromCookies(
	req: IncomingMessage,
	cookieName: string,
	getPlatformSession: (id: string) => { user_id: string; expires: number } | null
): string | null {
	const header = req.headers.cookie;
	if (!header) return null;
	const parsed = parseCookie(header, '; ');
	const sessionId = typeof parsed[cookieName] === 'string' ? (parsed[cookieName] as string) : null;
	if (!sessionId) return null;
	const session = getPlatformSession(sessionId);
	if (!session) return null;
	if (session.expires <= Math.floor(Date.now() / 1000)) return null;
	return session.user_id;
}
