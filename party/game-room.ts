/**
 * Shared game-logic core used by both party/server.ts (PartyKit) and
 * party/dev-server.ts (standalone ws).
 *
 * This module is transport-agnostic — all I/O goes through the `GameTransport`
 * interface so the same logic works across different WebSocket runtimes.
 */

// ============================================================
// Constants
// ============================================================

export const PLAYER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#9333ea",
  "#0891b2",
  "#d946ef",
  "#65a30d",
  "#4f46e5",
] as const;

export const TEAM_COLORS = { red: "#dc2626", blue: "#2563eb" } as const;

// ============================================================
// Data types
// ============================================================

export type GameMode = "classic" | "hex";
export type GamePhase = "lobby" | "countdown" | "playing";

export interface MarkEntry {
  by: string;
  timestamp: number;
}

export interface PlayerInfo {
  name: string;
  color: string;
  ready?: boolean;
}

export interface RoomState {
  config: unknown;
  marks: Record<string, MarkEntry[]>;
  players: Record<string, PlayerInfo>;
  phase: GamePhase;
  countdownSeconds: number | null;
  mode: GameMode;
  lockout: boolean;
  bonusScores: Record<string, number>;
  owner: string | null;
  configHash: string | null;
}

// Client → Server messages
export type ClientMsg =
  | {
      type: "join";
      name: string;
      config?: unknown;
      mode?: GameMode;
      lockout?: boolean;
      configHash?: string;
    }
  | { type: "mark"; index: number; by: string }
  | { type: "unmark"; index: number; by: string }
  | { type: "change_color"; name: string; color: string }
  | { type: "rename"; oldName: string; newName: string }
  | { type: "chat"; name: string; color: string; text: string }
  | { type: "ready"; name: string; ready: boolean }
  | { type: "bonus_score"; playerName: string; bonus: number }
  | { type: "restart"; config?: unknown; configHash?: string };

// Server → Client messages
export type ServerMsg =
  | {
      type: "state";
      config: unknown;
      marks: Record<string, MarkEntry[]>;
      players: Record<string, PlayerInfo>;
      phase: GamePhase;
      countdownSeconds: number | null;
      mode: GameMode;
      lockout: boolean;
      bonusScores: Record<string, number>;
      owner: string | null;
      configHash: string | null;
    }
  | {
      type: "rename_rejected";
      yourName: string;
      players: Record<string, PlayerInfo>;
    }
  | { type: "player_joined"; name: string; color: string }
  | { type: "player_left"; name: string }
  | { type: "mark"; index: number; by: string; marks: MarkEntry[] }
  | { type: "unmark"; index: number; by: string; marks: MarkEntry[] | null }
  | { type: "change_color"; name: string; color: string }
  | { type: "rename"; oldName: string; newName: string }
  | { type: "chat"; name: string; color: string; text: string }
  | { type: "ready"; name: string; ready: boolean }
  | { type: "start" }
  | { type: "bonus_score"; playerName: string; bonus: number };

// ============================================================
// Transport interface
// ============================================================

/**
 * Minimal transport abstraction so GameRoom doesn't depend on any
 * specific WebSocket runtime (PartyKit, ws, Deno, Bun, …).
 */
export interface GameTransport {
  /** Send a message to a single connection identified by its id. */
  send(connId: string, msg: ServerMsg): void;
  /** Broadcast a message to all connections except those listed. */
  broadcast(msg: ServerMsg, excludeConnIds?: string[]): void;
  /** Called when the last player leaves — transport-level cleanup (e.g. durable storage). */
  onRoomEmpty(): void;
}

// ============================================================
// GameRoom
// ============================================================

export class GameRoom {
  // ---------- state ----------
  config: unknown = null;
  marks: Record<string, MarkEntry[]> = {};
  players: Record<string, PlayerInfo> = {};
  phase: GamePhase = "lobby";
  countdownEnd: number | null = null;
  mode: GameMode = "classic";
  lockout = false;
  countdownTimer: ReturnType<typeof setTimeout> | null = null;
  /** connId → player name */
  connPlayers = new Map<string, string>();
  bonusScores: Record<string, number> = {};
  /** Room owner — the player who first provided config. */
  owner: string | null = null;
  /** Hash of the original goal pool + pick rule — used to authorize restart. */
  configHash: string | null = null;

  constructor(private transport: GameTransport) {}

  // ---------- derived ----------

  get playerCount(): number {
    return Object.keys(this.players).length;
  }

  get clientCount(): number {
    return this.connPlayers.size;
  }

  private get isLockoutMode(): boolean {
    return this.lockout || this.mode === "hex";
  }

  // ---------- state messages ----------

  private get stateMsg(): ServerMsg & { type: "state" } {
    return {
      type: "state",
      config: this.config,
      marks: this.marks,
      players: this.players,
      phase: this.phase,
      countdownSeconds:
        this.countdownEnd != null
          ? Math.max(0, Math.ceil((this.countdownEnd - Date.now()) / 1000))
          : null,
      mode: this.mode,
      lockout: this.lockout,
      bonusScores: this.bonusScores,
      owner: this.owner,
      configHash: this.configHash,
    };
  }

  private get lobbyStateMsg(): ServerMsg & { type: "state" } {
    return {
      type: "state",
      config: null,
      marks: {},
      players: this.players,
      phase: this.phase,
      countdownSeconds: null,
      mode: this.mode,
      lockout: this.lockout,
      bonusScores: this.bonusScores,
      owner: this.owner,
      configHash: this.configHash,
    };
  }

  // ---------- color assignment ----------

  private assignColor(): string {
    const used = new Set(Object.values(this.players).map((p) => p.color));
    for (const c of PLAYER_COLORS) {
      if (!used.has(c)) return c;
    }
    return PLAYER_COLORS[
      Object.keys(this.players).length % PLAYER_COLORS.length
    ];
  }

  private assignTeamColor(): string {
    let reds = 0,
      blues = 0;
    for (const p of Object.values(this.players)) {
      if (p.color === TEAM_COLORS.red) reds++;
      else if (p.color === TEAM_COLORS.blue) blues++;
    }
    return blues <= reds ? TEAM_COLORS.blue : TEAM_COLORS.red;
  }

  // ---------- countdown ----------

  private startCountdown(): void {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.phase = "countdown";
    this.countdownEnd = Date.now() + 3000;

    this.transport.broadcast(this.stateMsg);

    this.countdownTimer = setTimeout(() => {
      this.phase = "playing";
      this.countdownEnd = null;
      for (const p of Object.values(this.players)) {
        delete p.ready;
      }
      this.transport.broadcast({ type: "start" });
      this.countdownTimer = null;
    }, 3000);
  }

  // ---------- mark / unmark ----------

  private handleMark(index: number, by: string): boolean {
    const key = String(index);
    const existing = this.marks[key] ?? [];

    if (this.isLockoutMode) {
      if (existing.length > 0) return false;
      this.marks[key] = [{ by, timestamp: Date.now() }];
      return true;
    }

    const idx = existing.findIndex((e) => e.by === by);
    if (idx >= 0) {
      existing[idx] = { by, timestamp: Date.now() };
    } else {
      existing.push({ by, timestamp: Date.now() });
    }
    this.marks[key] = existing;
    return true;
  }

  private handleUnmark(index: number, by: string): boolean {
    const key = String(index);
    const existing = this.marks[key];
    if (!existing) return false;

    if (this.isLockoutMode) {
      if (existing[0]?.by !== by) return false;
    }

    const filtered = existing.filter((e) => e.by !== by);
    if (filtered.length === 0) {
      delete this.marks[key];
    } else {
      this.marks[key] = filtered;
    }
    return true;
  }

  // ---------- reset ----------

  private resetRoom(): void {
    this.config = null;
    this.phase = "lobby";
    this.marks = {};
    this.lockout = false;
    this.bonusScores = {};
    this.owner = null;
    this.configHash = null;
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEnd = null;
  }

  // ---------- public API ----------

  /** Called when a new connection is established. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleConnect(_connId: string): void {
    // No-op — wait for the "join" message to register the player.
  }

  /** Process an incoming message from a connection. */
  handleMessage(connId: string, raw: string): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "join": {
        const { name, config, mode, lockout: cfgLockout } = msg;
        const cleanName = name.trim();
        if (!cleanName) return;

        // Store config if this is the first player to provide one.
        // Config is already a compressed base64 string — server just
        // stores it as-is and forwards to clients without decompressing.
        if (config && !this.config) {
          this.config = config;
          if (mode) this.mode = mode;
          if (cfgLockout !== undefined) this.lockout = cfgLockout;
          this.owner = cleanName;
          if (msg.configHash) this.configHash = msg.configHash;
        }

        // Handle reconnect: player name already exists
        const existing = this.players[cleanName];
        if (existing) {
          this.connPlayers.set(connId, cleanName);
          this.transport.send(
            connId,
            this.phase === "lobby" ? this.lobbyStateMsg : this.stateMsg,
          );
          return;
        }

        // Assign color and add player
        const color =
          this.mode === "hex" ? this.assignTeamColor() : this.assignColor();
        this.players[cleanName] = { name: cleanName, color };
        this.connPlayers.set(connId, cleanName);

        // Send state to the new player — omit config & marks during lobby
        this.transport.send(
          connId,
          this.phase === "lobby" ? this.lobbyStateMsg : this.stateMsg,
        );

        // Notify others
        this.transport.broadcast(
          { type: "player_joined", name: cleanName, color },
          [connId],
        );
        break;
      }

      case "mark": {
        if (this.phase !== "playing") return;
        if (this.handleMark(msg.index, msg.by)) {
          const cellMarks = this.marks[String(msg.index)] ?? [];
          this.transport.broadcast({
            type: "mark",
            index: msg.index,
            by: msg.by,
            marks: cellMarks,
          });
        }
        break;
      }

      case "unmark": {
        if (this.phase !== "playing") return;
        if (this.handleUnmark(msg.index, msg.by)) {
          const cellMarks = this.marks[String(msg.index)] ?? null;
          this.transport.broadcast({
            type: "unmark",
            index: msg.index,
            by: msg.by,
            marks: cellMarks,
          });
        }
        break;
      }

      case "change_color": {
        const player = this.players[msg.name];
        if (!player) return;
        // Allow same color — players sharing a color are on the same team
        player.color = msg.color;
        this.transport.broadcast(msg, [connId]);
        break;
      }

      case "rename": {
        const player = this.players[msg.oldName];
        if (!player) return;
        const newName = msg.newName.trim();
        if (!newName || this.players[newName]) {
          // Rejected — alert the sender so they roll back the optimistic rename.
          this.transport.send(connId, {
            type: "rename_rejected",
            yourName: player.name,
            players: this.players,
          });
          return;
        }

        delete this.players[msg.oldName];
        player.name = newName;
        this.players[newName] = player;
        this.connPlayers.set(connId, newName);
        this.transport.broadcast(msg, [connId]);
        break;
      }

      case "chat": {
        this.transport.broadcast(msg, [connId]);
        break;
      }

      case "ready": {
        if (this.phase !== "lobby") return;
        const player = this.players[msg.name];
        if (!player) return;
        player.ready = msg.ready;
        this.transport.broadcast(msg, [connId]);

        // Check if all players are ready
        const all = Object.values(this.players);
        if (all.length > 0 && all.every((p) => p.ready === true)) {
          if (all.length === 1) {
            // Single player: start immediately without countdown
            if (this.countdownTimer) clearTimeout(this.countdownTimer);
            this.countdownTimer = null;
            this.phase = "playing";
            this.countdownEnd = null;
            delete all[0].ready;
            // Send full state first so the client receives the config
            // (the lobby state message omitted it). Otherwise HexRoom
            // shows "Loading board…" forever because state.config is null.
            this.transport.broadcast(this.stateMsg);
            this.transport.broadcast({ type: "start" });
          } else {
            this.startCountdown();
          }
        }
        break;
      }

      case "bonus_score": {
        this.bonusScores[msg.playerName] = msg.bonus;
        this.transport.broadcast(msg, [connId]);
        break;
      }

      case "restart": {
        // Only the room owner with the correct config hash can restart
        const playerName = this.connPlayers.get(connId);
        if (!playerName || playerName !== this.owner) return;
        if (this.configHash && msg.configHash !== this.configHash) return;

        // Accept new config if provided (re-randomized goals)
        if (msg.config !== undefined) {
          this.config = msg.config;
        }

        // Reset game state
        this.marks = {};
        this.phase = "lobby";
        this.bonusScores = {};

        // Clear all ready flags
        for (const p of Object.values(this.players)) {
          delete p.ready;
        }

        // Cancel any pending countdown
        if (this.countdownTimer) {
          clearTimeout(this.countdownTimer);
          this.countdownTimer = null;
        }
        this.countdownEnd = null;

        // Broadcast new lobby state to all players
        this.transport.broadcast(this.lobbyStateMsg);
        break;
      }
    }
  }

  /** Called when a connection closes. */
  handleClose(connId: string): void {
    const name = this.connPlayers.get(connId);
    if (!name) return;

    this.connPlayers.delete(connId);

    // Only remove player if they have no other connections
    for (const [, pname] of this.connPlayers) {
      if (pname === name) return; // still connected via another socket
    }

    delete this.players[name];
    this.transport.broadcast({ type: "player_left", name });

    // Destroy room when empty: reset all state so a late-joiner starts fresh.
    if (Object.keys(this.players).length === 0) {
      this.resetRoom();
      this.transport.onRoomEmpty();
    }
  }
}
