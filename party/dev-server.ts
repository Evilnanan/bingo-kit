/**
 * Development-only WebSocket server that mirrors the PartyServer API.
 *
 * Provides the same message protocol as party/server.ts without requiring
 * workerd/Cloudflare Workers runtime. Used with `npm run dev:server`.
 *
 * All game logic is shared via party/game-room.ts — this file is just the
 * transport adapter (WebSocket server + room management + image HTTP API).
 *
 * Production: `party/server.ts` deployed via `wrangler deploy`.
 * Development: `party/dev-server.ts` run via `tsx party/dev-server.ts`.
 */

import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { GameRoom, type GameTransport } from "./game-room";

// ============================================================
// Helpers
// ============================================================

let nextId = 0;
const wsIds = new WeakMap<WebSocket, string>();

function getWsId(ws: WebSocket): string {
  const existing = wsIds.get(ws);
  if (existing) return existing;
  const id = `ws_${nextId++}`;
  wsIds.set(ws, id);
  return id;
}

// ============================================================
// Server state
// ============================================================

const PORT = parseInt(process.env.PORT || "1999", 10);
const IMAGE_DIR = path.resolve(process.cwd(), ".dev-images");

// Ensure image directory exists
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

interface RoomEntry {
  game: GameRoom;
  sockets: Map<string, WebSocket>;
}

const rooms = new Map<string, RoomEntry>();

function getRoom(name: string): RoomEntry {
  let entry = rooms.get(name);
  if (!entry) {
    const sockets = new Map<string, WebSocket>();
    const transport: GameTransport = {
      send: (connId, msg) => {
        const ws = sockets.get(connId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
      broadcast: (msg, excludeConnIds) => {
        const data = JSON.stringify(msg);
        const excludeSet = new Set(excludeConnIds ?? []);
        for (const [id, ws] of sockets) {
          if (!excludeSet.has(id) && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        }
      },
      onRoomEmpty: () => {
        // No durable storage to clean up in dev mode. Drop the room entry so
        // the next join starts fresh; this only runs after the reconnect
        // grace period expires and the last player is truly removed.
        rooms.delete(name);
      },
    };
    const game = new GameRoom(transport);
    entry = { game, sockets };
    rooms.set(name, entry);
  }
  return entry;
}

function cleanupConnection(roomName: string, connId: string): void {
  const entry = rooms.get(roomName);
  if (!entry) return;
  entry.game.handleClose(connId);
  entry.sockets.delete(connId);
}

// ============================================================
// Stale-connection sweep (mirrors party/server.ts)
// ============================================================

/**
 * How long a connection may go silent before the server closes it. Clients
 * send an app-level "ping" heartbeat every 30s; 180s tolerates several missed
 * beats. Backstop for sockets the transport never reports as dead (killed
 * browser process, network blackhole): the TCP connection can stay half-open
 * for hours, so `close` never fires and the player would linger forever.
 */
const STALE_CONNECTION_MS = 180_000;

/** How often the server sweeps for stale connections. */
const SWEEP_INTERVAL_MS = 30_000;

/** connId → last time the connection sent any message (any message counts,
 *  including the app-level "ping" heartbeat). */
const lastSeen = new Map<string, number>();

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the stale-connection sweep while any connection is registered. */
function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepStaleConnections();
  }, SWEEP_INTERVAL_MS);
}

/** Stop the sweep once no connections remain so the process can idle. */
function stopSweepIfIdle(): void {
  if (!sweepTimer) return;
  let count = 0;
  for (const entry of rooms.values()) count += entry.sockets.size;
  if (count === 0) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Handle connections that stopped sending messages (including heartbeats).
 * Like party/server.ts, this runs the game-level close path (`handleClose`)
 * itself and does NOT rely on `ws.close()` firing the socket's "close" event:
 * with a dead peer the close handshake never completes, so the event never
 * fires and the player would stay in the room forever. `handleClose` keeps the
 * normal reconnect grace: a client that reconnects within the window cancels
 * the pending removal, a truly dead one is removed a few minutes later. The
 * socket close afterwards is best-effort transport teardown only.
 */
function sweepStaleConnections(): void {
  const now = Date.now();
  for (const entry of rooms.values()) {
    for (const [connId, ws] of [...entry.sockets.entries()]) {
      const seen = lastSeen.get(connId) ?? now;
      if (now - seen <= STALE_CONNECTION_MS) continue;
      lastSeen.delete(connId);
      entry.game.handleClose(connId);
      entry.sockets.delete(connId);
      try {
        ws.close(4001, "heartbeat timeout");
      } catch {
        // Already closing/closed — the game state above is already handled.
      }
    }
  }
  stopSweepIfIdle();
}

// ============================================================
// Image HTTP API (mirrors R2 endpoints in party/server.ts)
// ============================================================

const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, PUT, POST, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function getImagePath(hash: string): string {
  return path.join(IMAGE_DIR, hash);
}

function getMetaPath(hash: string): string {
  return path.join(IMAGE_DIR, `${hash}.json`);
}

interface ImageMeta {
  contentType?: string;
  uploadedAt?: number;
}

async function handleImageRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const origin = req.headers.origin ?? null;
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  const hash = url.pathname.slice("/images/".length);

  // CORS preflight
  if (req.method === "OPTIONS") {
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      res.setHeader(k, v);
    }
    res.writeHead(204).end();
    return;
  }

  // Validate hash
  if (!HASH_RE.test(hash)) {
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      res.setHeader(k, v);
    }
    res.writeHead(400).end("Invalid hash");
    return;
  }

  const filePath = getImagePath(hash);
  const metaPath = getMetaPath(hash);

  // GET / HEAD /images/:hash
  if (req.method === "GET" || req.method === "HEAD") {
    if (!fs.existsSync(filePath)) {
      for (const [k, v] of Object.entries(corsHeaders(origin))) {
        res.setHeader(k, v);
      }
      res.writeHead(404).end("Not Found");
      return;
    }

    const stat = fs.statSync(filePath);
    let meta: ImageMeta = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as ImageMeta;
      } catch {
        // Ignore corrupted meta
      }
    }

    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      res.setHeader(k, v);
    }
    res.setHeader(
      "Content-Type",
      meta.contentType ?? "application/octet-stream",
    );
    res.setHeader("Cache-Control", "public, max-age=2592000");
    res.setHeader("Content-Length", String(stat.size));

    if (req.method === "HEAD") {
      res.writeHead(200).end();
    } else {
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // PUT /images/:hash
  if (req.method === "PUT") {
    const length = parseInt(req.headers["content-length"] ?? "0", 10);
    if (length > MAX_IMAGE_SIZE) {
      for (const [k, v] of Object.entries(corsHeaders(origin))) {
        res.setHeader(k, v);
      }
      res.writeHead(413).end("Image too large");
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    req.on("end", () => {
      if (total > MAX_IMAGE_SIZE) {
        for (const [k, v] of Object.entries(corsHeaders(origin))) {
          res.setHeader(k, v);
        }
        res.writeHead(413).end("Image too large");
        return;
      }

      const body = Buffer.concat(chunks, total);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, body);

      const meta: ImageMeta = {
        contentType: req.headers["content-type"] ?? "application/octet-stream",
        uploadedAt: Date.now(),
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta));

      for (const [k, v] of Object.entries(corsHeaders(origin))) {
        res.setHeader(k, v);
      }
      res.setHeader("Content-Type", "application/json");
      res.writeHead(201).end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Unknown method
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    res.setHeader(k, v);
  }
  res.writeHead(405).end("Method Not Allowed");
}

// ============================================================
// HTTP + WebSocket server
// ============================================================

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // Route image API
  if (url.startsWith("/images/")) {
    void handleImageRequest(req, res);
    return;
  }

  // Everything else → 404 (WebSocket upgrade or nothing)
  res.writeHead(404).end("Not Found");
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`🎈 Dev server running on ws://localhost:${PORT}`);
  console.log(`   Image API: http://localhost:${PORT}/images/:hash`);
  console.log("   (Protocol-compatible with party/server.ts)");
});

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  // PartyServer URL format: /parties/:partyName/:roomName
  // e.g. /parties/main/my-room  → roomName = "my-room"
  // Also support legacy: /party/:roomName
  const urlObj = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  let roomName: string;

  if (pathParts[0] === "parties") {
    roomName = pathParts[2] || "default";
  } else if (pathParts[0] === "party") {
    roomName = pathParts[1] || "default";
  } else {
    roomName = "default";
  }

  const connId = getWsId(ws);
  const entry = getRoom(roomName);
  entry.sockets.set(connId, ws);
  entry.game.handleConnect(connId);
  lastSeen.set(connId, Date.now());
  ensureSweep();

  console.log(`[connect] room="${roomName}"`);

  ws.on("message", (data) => {
    lastSeen.set(connId, Date.now());
    entry.game.handleMessage(connId, data.toString());
  });

  ws.on("close", () => {
    lastSeen.delete(connId);
    cleanupConnection(roomName, connId);
    stopSweepIfIdle();
    console.log(`[disconnect] room="${roomName}"`);
  });

  ws.on("error", (err) => {
    console.error(`[error] room="${roomName}":`, err.message);
    cleanupConnection(roomName, connId);
    stopSweepIfIdle();
  });
});

console.log(`Starting dev server on port ${PORT}...`);
