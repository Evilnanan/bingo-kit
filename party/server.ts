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
 * the edge for hours, which keeps the player in the room forever, because
 * `onClose`/the reconnect-grace timer never fire.
 */
const STALE_CONNECTION_MS = 180_000;

/** How often the server sweeps for stale connections (via a persistent DO
 *  alarm — NOT setInterval, which dies with the in-memory state when the
 *  Durable Object is evicted after ~30s of inactivity. A room that goes
 *  completely idle — no live observers, only a dead phone connection — must
 *  still be swept, so the sweep is driven by a persistent alarm that wakes
 *  the DO even after eviction). */
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
  /** True while a sweep alarm is pending, to avoid storage reads on every
   *  message. Reset when the alarm fires. */
  private sweepAlarmScheduled = false;

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

  /**
   * Make sure a sweep alarm is pending. Driven by a persistent Durable Object
   * alarm instead of an in-memory setInterval: alarms survive eviction, so a
   * room that goes completely idle (no live observers, only dead sockets)
   * still gets swept — an interval would be lost when the runtime is evicted
   * after ~30s of inactivity and the zombie player would linger forever.
   */
  private async ensureSweepAlarm(): Promise<void> {
    if (this.sweepAlarmScheduled) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
    this.sweepAlarmScheduled = true;
  }

  /** The persistent sweep tick: connection sweep + player deadline sweep. */
  override async onAlarm(): Promise<void> {
    this.sweepAlarmScheduled = false;
    const game = await this.getGameReady();
    this.sweepStaleConnections();
    // Players whose reconnect grace expired while the runtime was evicted
    // (in-memory timers are gone; deadlines were restored from the snapshot).
    if (game.sweepExpiredDisconnects(Date.now())) {
      this.saveSnapshot(game.serialize());
    }
    // Keep the alarm chain alive while there is anything left to clean up.
    // An empty room stops the chain (onRoomEmpty's deleteAll clears storage).
    if (game.playerCount > 0 || this.hasLiveConnections()) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
      this.sweepAlarmScheduled = true;
    }
  }

  private hasLiveConnections(): boolean {
    for (const _ of this.getConnections()) return true;
    return false;
  }

  /**
   * Close connections that stopped sending messages (including heartbeats).
   *
   * IMPORTANT: this must run the game-level close path (`handleClose`) itself
   * and must NOT rely on `conn.close()` eventually firing `onClose`. In
   * workerd, a server-initiated close only dispatches the WebSocket "close"
   * event once the peer completes the close handshake — and the whole point of
   * this sweep is a peer that is gone (killed browser/phone): the close frame
   * goes into a black hole, no close frame ever comes back, `onClose` never
   * fires, and the player would linger in the room forever. So the sweep
   * treats the connection as dead right away: same `handleClose` → reconnect
   * grace → removal path as a real disconnect. A client that merely had a long
   * hiccup still reconnects (PartySocket backoff, tab resuming) and its rejoin
   * cancels the pending removal; a truly dead one is removed a few minutes
   * later instead of lingering forever. The socket close afterwards is
   * best-effort transport teardown only.
   */
  private sweepStaleConnections(): void {
    const now = Date.now();
    const game = this.getGame();
    let sweptAny = false;
    for (const conn of this.getConnections()) {
      const seen = this.lastSeen.get(conn.id) ?? now;
      if (now - seen <= STALE_CONNECTION_MS) continue;
      sweptAny = true;
      this.lastSeen.delete(conn.id);
      game.handleClose(conn.id);
      try {
        conn.close(4001, "heartbeat timeout");
      } catch {
        // Already closing/closed — the game state above is already handled.
      }
    }
    if (sweptAny) this.saveSnapshot(game.serialize());
  }

  override async onConnect(conn: Connection) {
    const game = await this.getGameReady();
    this.lastSeen.set(conn.id, Date.now());
    await this.ensureSweepAlarm();
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
    await this.ensureSweepAlarm();
  }

  override async onClose(conn: Connection) {
    this.lastSeen.delete(conn.id);
    const game = await this.getGameReady();
    game.handleClose(conn.id);
    this.saveSnapshot(game.serialize());
    await this.ensureSweepAlarm();
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
