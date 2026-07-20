/**
 * PartyKit server — thin adapter around the shared GameRoom logic.
 *
 * All game logic lives in party/game-room.ts so it can be shared with the
 * standalone dev-server (party/dev-server.ts).
 */

import type * as Party from "partykit/server";
import { GameRoom, type GameTransport, type ServerMsg } from "./game-room";

export default class BingoServer implements Party.Server {
  private game: GameRoom | null = null;

  constructor(readonly room: Party.Room) {}

  private getGame(): GameRoom {
    if (!this.game) {
      const transport: GameTransport = {
        send: (connId, msg) => {
          void this.sendTo(connId, msg);
        },
        broadcast: (msg, exclude) => {
          this.room.broadcast(JSON.stringify(msg), exclude);
        },
        onRoomEmpty: () => {
          this.room.storage.deleteAll().catch(() => {
            // Silently ignore — storage cleanup is best-effort
          });
        },
      };
      this.game = new GameRoom(transport);
    }
    return this.game;
  }

  /** Resolve a connection-id string back to a Party.Connection and send. */
  private sendTo(connId: string, msg: ServerMsg): void {
    for (const conn of this.room.getConnections()) {
      if (conn.id === connId) {
        conn.send(JSON.stringify(msg));
        return;
      }
    }
  }

  async onConnect(conn: Party.Connection) {
    this.getGame().handleConnect(conn.id);
  }

  async onMessage(message: string, sender: Party.Connection) {
    this.getGame().handleMessage(sender.id, message);
  }

  async onClose(conn: Party.Connection) {
    this.getGame().handleClose(conn.id);
  }
}
