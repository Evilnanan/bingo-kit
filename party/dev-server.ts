/**
 * Development-only WebSocket server that mirrors the PartyKit server API.
 *
 * Provides the same message protocol as party/server.ts without requiring
 * workerd/Cloudflare Workers runtime. Used with `npm run dev:server`.
 *
 * All game logic is shared via party/game-room.ts — this file is just the
 * transport adapter (WebSocket server + room management).
 *
 * Production: `party/server.ts` deployed via `partykit deploy`.
 * Development: `party/dev-server.ts` run via `tsx party/dev-server.ts`.
 */

import { WebSocketServer, WebSocket } from "ws";
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
        // No durable storage to clean up in dev mode.
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
  if (entry.sockets.size === 0) {
    rooms.delete(roomName);
  }
}

// ============================================================
// WebSocket server
// ============================================================

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  console.log(`🎈 Dev server running on ws://localhost:${PORT}`);
  console.log("   (Protocol-compatible with party/server.ts)");
});

wss.on("connection", (ws: WebSocket, req) => {
  // PartyKit URL format: /parties/:partyName/:roomName
  // e.g. /parties/main/my-room  → roomName = "my-room"
  // Also support legacy: /party/:roomName
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathParts = url.pathname.split("/").filter(Boolean);
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

  console.log(`[connect] room="${roomName}" (${wss.clients.size} clients)`);

  ws.on("message", (data) => {
    entry.game.handleMessage(connId, data.toString());
  });

  ws.on("close", () => {
    cleanupConnection(roomName, connId);
    console.log(
      `[disconnect] room="${roomName}" (${wss.clients.size} clients)`,
    );
  });

  ws.on("error", (err) => {
    console.error(`[error] room="${roomName}":`, err.message);
    cleanupConnection(roomName, connId);
  });
});

console.log(`Starting dev server on port ${PORT}...`);
