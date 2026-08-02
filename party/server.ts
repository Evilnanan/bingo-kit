/// <reference types="@cloudflare/workers-types" />

/**
 * PartyServer (Cloudflare Durable Objects) adapter around the shared
 * GameRoom logic.
 *
 * All game logic lives in party/game-room.ts so it can be shared with the
 * standalone dev-server (party/dev-server.ts).
 *
 * Image upload/serving is handled by a separate Cloudflare Worker
 * (image-worker/) with R2 bindings, not by this server.
 *
 * Production: `wrangler deploy` (configured in wrangler.jsonc).
 * Development: `wrangler dev`, or `party/dev-server.ts` for a workerd-free
 * local server.
 */

import { Server, routePartykitRequest, type Connection } from "partyserver";
import { GameRoom, type GameTransport } from "./game-room";

export interface Env {
  /** Durable Object binding, declared in wrangler.jsonc. */
  BingoServer: DurableObjectNamespace;
}

export class BingoServer extends Server<Env> {
  private game: GameRoom | null = null;

  private getGame(): GameRoom {
    if (!this.game) {
      const transport: GameTransport = {
        send: (connId, msg) => {
          const conn = this.getConnection(connId);
          if (conn) conn.send(JSON.stringify(msg));
        },
        broadcast: (msg, exclude) => {
          this.broadcast(JSON.stringify(msg), exclude);
        },
        onRoomEmpty: () => {
          this.ctx.storage.deleteAll().catch(() => {
            // Silently ignore - storage cleanup is best-effort
          });
        },
      };
      this.game = new GameRoom(transport);
    }
    return this.game;
  }

  override onConnect(conn: Connection) {
    this.getGame().handleConnect(conn.id);
  }

  override onMessage(
    conn: Connection,
    message: string | ArrayBuffer | ArrayBufferView,
  ) {
    this.getGame().handleMessage(conn.id, String(message));
  }

  override onClose(conn: Connection) {
    this.getGame().handleClose(conn.id);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ||
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
