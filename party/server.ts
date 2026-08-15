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

/**
 * How long a connection may go silent before the server closes it. Clients
 * send an app-level "ping" heartbeat every 30s (see HEARTBEAT_INTERVAL_MS in
 * usePartyConnection.ts); background-tab timer throttling can stretch that to
 * ~60s, so 180s tolerates several missed beats. This is the server-side
 * backstop for sockets the transport never reports as dead — e.g. a phone
 * whose browser was force-closed: the TCP connection can stay half-open at
 * the edge for hours, which keeps this Durable Object alive (without
 * hibernation, open WebSockets block eviction) and the player in the room
 * forever, because `onClose`/the reconnect-grace timer never fire.
 */
const STALE_CONNECTION_MS = 180_000;

/** How often the server sweeps for stale connections. */
const SWEEP_INTERVAL_MS = 30_000;

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
  /** connId → last time the connection sent any message (any message counts,
   *  including the app-level "ping" heartbeat). */
  private lastSeen = new Map<string, number>();
  /** Periodic sweep that closes connections silent for too long. */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

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

  /** Start the stale-connection sweep while any connection is registered. */
  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      this.sweepStaleConnections();
    }, SWEEP_INTERVAL_MS);
  }

  /** Stop the sweep once no connections remain so the DO can go idle. */
  private stopSweepIfIdle(): void {
    if (this.sweepTimer && this.lastSeen.size === 0) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Close connections that stopped sending messages (including heartbeats).
   * Closing the socket triggers the normal onClose → handleClose → reconnect
   * grace → removal path: a live client that reconnects within the grace
   * window (PartySocket backoff, tab resuming) is preserved, while a truly
   * dead one is removed a few minutes later instead of lingering forever.
   */
  private sweepStaleConnections(): void {
    const now = Date.now();
    for (const conn of this.getConnections()) {
      const seen = this.lastSeen.get(conn.id) ?? now;
      if (now - seen <= STALE_CONNECTION_MS) continue;
      try {
        conn.close(4001, "heartbeat timeout");
      } catch {
        // Already closing/closed — onClose will clean up.
      }
    }
    this.stopSweepIfIdle();
  }

  override async onConnect(conn: Connection) {
    const game = await this.getGameReady();
    this.lastSeen.set(conn.id, Date.now());
    this.ensureSweep();
    game.handleConnect(conn.id);
  }

  override async onMessage(
    conn: Connection,
    message: string | ArrayBuffer | ArrayBufferView,
  ) {
    this.lastSeen.set(conn.id, Date.now());
    const game = await this.getGameReady();
    game.handleMessage(conn.id, String(message));
    this.saveSnapshot(game.serialize());
  }

  override async onClose(conn: Connection) {
    this.lastSeen.delete(conn.id);
    this.stopSweepIfIdle();
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
