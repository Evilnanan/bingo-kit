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
import {
  GameRoom,
  type GameTransport,
  type GameRoomSnapshot,
} from "./game-room";

export interface Env {
  /** Durable Object binding, declared in wrangler.jsonc. */
  BingoServer: DurableObjectNamespace;
}

/** Storage key for the serialized room snapshot. */
const ROOM_STATE_KEY = "room-state";

export class BingoServer extends Server<Env> {
  private game: GameRoom | null = null;
  /**
   * Restores the persisted room once per instance. All handlers await this
   * before touching the game: a Durable Object can be restarted at any time
   * (deployment, maintenance, eviction after every socket dropped), and
   * without a restore the room would silently come back as a fresh lobby —
   * the in-memory reconnect grace timers would be gone too.
   */
  private gameReady: Promise<GameRoom> | null = null;

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
        persist: (snapshot) => {
          this.saveSnapshot(snapshot);
        },
      };
      this.game = new GameRoom(transport);
    }
    return this.game;
  }

  /** Persist the room so a restarted runtime can rebuild it. Best-effort. */
  private saveSnapshot(snapshot: GameRoomSnapshot): void {
    // An emptied room must stay empty: onRoomEmpty's deleteAll is
    // authoritative, so never write an empty snapshot back.
    if (Object.keys(snapshot.players).length === 0) return;
    this.ctx.storage.put(ROOM_STATE_KEY, JSON.stringify(snapshot)).catch(() => {
      // Silently ignore - persistence is best-effort
    });
  }

  /** The game, with the persisted room snapshot restored on a cold start. */
  private getGameReady(): Promise<GameRoom> {
    if (!this.gameReady) {
      this.gameReady = (async () => {
        const game = this.getGame();
        try {
          const saved = await this.ctx.storage.get<string>(ROOM_STATE_KEY);
          if (saved) {
            game.restore(JSON.parse(saved) as GameRoomSnapshot);
          }
        } catch {
          // Corrupt/unreadable snapshot: start fresh.
        }
        return game;
      })();
    }
    return this.gameReady;
  }

  override async onConnect(conn: Connection) {
    const game = await this.getGameReady();
    game.handleConnect(conn.id);
  }

  override async onMessage(
    conn: Connection,
    message: string | ArrayBuffer | ArrayBufferView,
  ) {
    const game = await this.getGameReady();
    game.handleMessage(conn.id, String(message));
    this.saveSnapshot(game.serialize());
  }

  override async onClose(conn: Connection) {
    const game = await this.getGameReady();
    game.handleClose(conn.id);
    this.saveSnapshot(game.serialize());
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
