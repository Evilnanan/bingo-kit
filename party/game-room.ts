/**
 * Shared game-logic core used by both party/server.ts (PartyServer) and
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

/**
 * How long a passively disconnected player is kept in the room before being
 * removed. Long enough for PartySocket's reconnect backoff (and a background
 * tab resuming) to restore the player, short enough that a dead session
 * doesn't occupy a slot for long. An explicit "leave" removes immediately.
 */
export const RECONNECT_GRACE_MS = 300_000;

/**
 * Validate a todo's linkedCells payload: keep non-negative integers only,
 * de-duplicate, and drop the field entirely when empty.
 */
function sanitizeLinkedCells(value: unknown): { linkedCells?: number[] } {
  if (!Array.isArray(value)) return {};
  const cells = Array.from(
    new Set(
      value.filter(
        (v): v is number =>
          typeof v === "number" && Number.isInteger(v) && v >= 0,
      ),
    ),
  );
  if (cells.length === 0) return {};
  return { linkedCells: cells };
}

// ============================================================
// Room timer constants & validation
// ============================================================

/** Longest allowed countdown (24 h). */
const MAX_TIMER_SECONDS = 24 * 60 * 60;
/** Hard cap on queued timers per room (anti-abuse). */
const MAX_ROOM_TIMERS = 100;
/** Max length of a timer name/description. */
const MAX_TIMER_NAME = 100;
/** Max length of a client-generated timer id. */
const MAX_TIMER_ID = 64;

/**
 * Validate an owner-submitted timer list: keep only well-formed timers and
 * drop everything else (wrong types, empty ids, countdowns without a
 * duration, ...). Never trusts the client.
 */
function sanitizeTimers(value: unknown): RoomTimer[] {
  if (!Array.isArray(value)) return [];
  const out: RoomTimer[] = [];
  for (const item of value) {
    if (out.length >= MAX_ROOM_TIMERS) break;
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      !raw.id ||
      raw.id.length > MAX_TIMER_ID
    ) {
      continue;
    }
    const mode =
      raw.mode === "countup"
        ? "countup"
        : raw.mode === "countdown"
          ? "countdown"
          : null;
    if (!mode) continue;
    const name =
      typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_TIMER_NAME) : "";
    if (mode === "countdown") {
      const duration = raw.duration;
      if (
        typeof duration !== "number" ||
        !Number.isInteger(duration) ||
        duration < 1 ||
        duration > MAX_TIMER_SECONDS
      ) {
        continue;
      }
      out.push({ id: raw.id, name, mode, duration });
    } else {
      out.push({ id: raw.id, name, mode, duration: 0 });
    }
  }
  return out;
}

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

/** A personal planning note, synced only to same-name connections. */
export interface PlayerNote {
  id: string;
  text: string;
  /** When true the note is a todo item and shows a done checkbox. */
  todo: boolean;
  /** Completion state for todo notes. */
  done: boolean;
  /** Board cell indices linked to this todo. Checking/unchecking the todo
   *  triggers a mark/unmark on these cells (todo acts as a trigger only). */
  linkedCells?: number[];
}

// ---------- room timer ----------

/** Whether a room timer counts down to zero or up from zero. */
export type TimerMode = "countdown" | "countup";
/** Overall state of the serial timer queue. */
export type TimerStatus = "idle" | "running" | "paused" | "finished";

/** One entry of the serial timer queue, set up by the room owner. */
export interface RoomTimer {
  /** Client-generated unique id. */
  id: string;
  /** Human-readable description shown to all players. */
  name: string;
  mode: TimerMode;
  /** Countdown length in seconds; always 0 for count-up timers. */
  duration: number;
}

/**
 * Server-authoritative room timer state. All wall-clock fields use the
 * *server's* clock: clients render from absolute timestamps and only need
 * their offset to the server clock (see src/utils/serverClock.ts), which
 * keeps players in sync even with wrong local clocks or high latency.
 */
export interface RoomTimerState {
  /** The full serial queue. */
  timers: RoomTimer[];
  /** Index of the current timer in `timers`, -1 when nothing is active. */
  currentIndex: number;
  status: TimerStatus;
  /** Server-clock time (ms) when a running countdown reaches 0. */
  endAt: number | null;
  /** Server-clock time (ms) when a running count-up segment started. */
  startedAt: number | null;
  /** Seconds remaining on a paused (or just-finished) countdown. */
  pausedRemaining: number | null;
  /** Seconds elapsed on a paused (or just-finished) count-up. */
  pausedElapsed: number | null;
  /** When true, a fresh queue run starts automatically the moment the game
   *  starts (all players ready → countdown ends, or a single player), so the
   *  timer runs together with the room without the owner pressing start. */
  autoStart: boolean;
}

/** A stored chat message, timestamped by the server when it arrives. */
export interface ChatRecord {
  name: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface RoomState {
  config: unknown;
  /** Pool metadata (name/description/images) — shared at join, unlike board config. */
  metadata: unknown;
  marks: Record<string, MarkEntry[]>;
  players: Record<string, PlayerInfo>;
  /** Per-player identity code, used to let a player's other devices join the same name. */
  playerCodes: Record<string, string>;
  phase: GamePhase;
  countdownSeconds: number | null;
  mode: GameMode;
  lockout: boolean;
  bonusScores: Record<string, number>;
  owner: string | null;
  configHash: string | null;
  /** Per-player star marks (cell indices), only sent back to the same name. */
  starMarks: Record<string, number[]>;
  /** Per-player counter progress, only sent back to the same name. */
  counters: Record<string, Record<string, number>>;
  /** Per-player planning notes, only sent back to the same name. */
  notes: Record<string, PlayerNote[]>;
  /** Per-player unread-chat flag, synced to same-name connections. */
  unreadChat: Record<string, boolean>;
  /** Room chat history, replayed to late joiners and reconnecting players. */
  chats: ChatRecord[];
  /** Serial room timer queue + run state. */
  timer: RoomTimerState;
}

// Client → Server messages
export type ClientMsg =
  | {
      type: "join";
      name: string;
      /** Identity code proving this connection belongs to the same player. */
      code?: string;
      config?: unknown;
      metadata?: unknown;
      mode?: GameMode;
      lockout?: boolean;
      configHash?: string;
    }
  | { type: "mark"; index: number; by: string }
  | { type: "unmark"; index: number; by: string }
  | { type: "change_color"; name: string; color: string }
  | { type: "rename"; oldName: string; newName: string }
  | {
      type: "chat";
      name: string;
      color: string;
      text: string;
      timestamp: number;
    }
  | { type: "ready"; name: string; ready: boolean }
  | { type: "bonus_score"; playerName: string; bonus: number }
  | { type: "restart"; config?: unknown; configHash?: string }
  | { type: "toggle_star"; name: string; index: number; starred: boolean }
  | { type: "set_counter"; name: string; index: number; value: number }
  | { type: "add_note"; name: string; note: PlayerNote }
  | { type: "set_chat_unread"; name: string; unread: boolean }
  | { type: "change_code"; name: string; code: string }
  | { type: "ping"; t?: number }
  | { type: "leave"; name: string }
  | { type: "kick"; name: string }
  | {
      type: "timer_submit";
      timers: RoomTimer[];
      /** Always replaces the queue. Deleting rows never disturbs a run
       *  unless the currently running/paused timer itself is removed: the
       *  run carries on and tracks the timer's new position. Submitting an
       *  empty list ends the run; the owner may also interrupt explicitly
       *  via `timer_stop`. */
      autoStart?: boolean;
    }
  | { type: "timer_start" }
  | { type: "timer_pause" }
  | { type: "timer_stop" }
  | { type: "timer_next" }
  | {
      type: "update_note";
      name: string;
      id: string;
      text?: string;
      todo?: boolean;
      done?: boolean;
      /** Board cell indices to link. null or [] clears the link. */
      linkedCells?: number[] | null;
    }
  | { type: "delete_note"; name: string; id: string }
  | { type: "reorder_notes"; name: string; ids: string[] };

// Server → Client messages
export type ServerMsg =
  | {
      type: "state";
      config: unknown;
      metadata: unknown;
      marks: Record<string, MarkEntry[]>;
      players: Record<string, PlayerInfo>;
      phase: GamePhase;
      countdownSeconds: number | null;
      mode: GameMode;
      lockout: boolean;
      bonusScores: Record<string, number>;
      owner: string | null;
      configHash: string | null;
      myStars?: number[];
      myCounters?: Record<string, number>;
      myNotes?: PlayerNote[];
      myUnreadChat?: boolean;
      /** This connection's player name (authoritative, e.g. after a retry rename). */
      myName?: string;
      /** This player's identity code — only sent back to the matching connection. */
      myCode?: string | null;
      /** Serial room timer queue + run state. */
      timer?: RoomTimerState;
      /** Server clock at send time — lets clients estimate their clock offset. */
      serverTime?: number;
    }
  | {
      type: "join_rejected";
      /** The name that could not be joined. */
      name: string;
      /** Missing or mismatched identity code (treated as the same error). */
      reason: "bad_code";
    }
  | {
      type: "rename_rejected";
      yourName: string;
      players: Record<string, PlayerInfo>;
    }
  | { type: "code_changed"; name: string; code: string }
  | { type: "player_joined"; name: string; color: string }
  | { type: "player_left"; name: string }
  | {
      type: "kick_rejected";
      /** The player that could not be removed. */
      name: string;
      /** The target still has a live connection, so removal is invalid. */
      reason: "online";
    }
  | { type: "mark"; index: number; by: string; marks: MarkEntry[] }
  | { type: "unmark"; index: number; by: string; marks: MarkEntry[] | null }
  | { type: "change_color"; name: string; color: string }
  | { type: "rename"; oldName: string; newName: string }
  | { type: "chat"; name: string; color: string; text: string }
  | { type: "ready"; name: string; ready: boolean }
  | { type: "start" }
  | { type: "bonus_score"; playerName: string; bonus: number }
  | { type: "star"; name: string; index: number; starred: boolean }
  | { type: "counter"; name: string; index: number; value: number }
  | { type: "note_added"; name: string; note: PlayerNote }
  | { type: "note_updated"; name: string; note: PlayerNote }
  | { type: "note_deleted"; name: string; id: string }
  | { type: "notes_reordered"; name: string; ids: string[] }
  | { type: "chat_unread"; name: string; unread: boolean }
  | { type: "chat_history"; chats: ChatRecord[] }
  | {
      type: "timer_state";
      timers: RoomTimer[];
      currentIndex: number;
      status: TimerStatus;
      endAt: number | null;
      startedAt: number | null;
      pausedRemaining: number | null;
      pausedElapsed: number | null;
      /** Whether the queue auto-starts with the game. */
      autoStart: boolean;
      /** Server clock at send time — lets clients estimate their clock offset. */
      serverTime: number;
    }
  | { type: "pong"; serverTime: number; t?: number };

// ============================================================
// Transport interface
// ============================================================

/**
 * A JSON-serializable snapshot of everything needed to rebuild the room in a
 * fresh runtime instance (Durable Object restart, deployment, eviction after
 * every socket dropped). Connection mappings and in-flight timers are
 * deliberately excluded — they are re-derived on restore.
 */
export interface GameRoomSnapshot {
  config: unknown;
  metadata: unknown;
  mode: GameMode;
  lockout: boolean;
  marks: Record<string, MarkEntry[]>;
  players: Record<string, PlayerInfo>;
  phase: GamePhase;
  countdownEnd: number | null;
  bonusScores: Record<string, number>;
  owner: string | null;
  configHash: string | null;
  starMarks: Record<string, number[]>;
  counters: Record<string, Record<string, number>>;
  notes: Record<string, PlayerNote[]>;
  unreadChat: Record<string, boolean>;
  chats: ChatRecord[];
  playerCodes: Record<string, string>;
  /**
   * Player name → absolute timestamp when the reconnect grace period ends.
   * Persisted so a restarted runtime (eviction, deployment) still knows which
   * disconnected players must be removed — the in-memory grace timers are
   * gone, and without the deadline the removal clock would restart on every
   * restore, letting a zombie player live forever.
   */
  disconnectDeadlines?: Record<string, number>;
  /**
   * Serial room timer queue + run state. Optional so snapshots written by an
   * older build (without the timer) still restore cleanly.
   */
  timers?: RoomTimer[];
  timerIndex?: number;
  timerStatus?: TimerStatus;
  timerEndAt?: number | null;
  timerStartedAt?: number | null;
  timerPausedRemaining?: number | null;
  timerPausedElapsed?: number | null;
  /** Whether the queue auto-starts with the game (survives restart). */
  timerAutoStart?: boolean;
}

/**
 * Minimal transport abstraction so GameRoom doesn't depend on any
 * specific WebSocket runtime (PartyServer, ws, Deno, Bun, ...).
 */
export interface GameTransport {
  /** Send a message to a single connection identified by its id. */
  send(connId: string, msg: ServerMsg): void;
  /** Broadcast a message to all connections except those listed. */
  broadcast(msg: ServerMsg, excludeConnIds?: string[]): void;
  /** Called when the last player leaves — transport-level cleanup (e.g. durable storage). */
  onRoomEmpty(): void;
  /**
   * Persist the current room snapshot so the room can be rebuilt after the
   * runtime restarts. Optional: the standalone dev-server keeps rooms in
   * memory only. The adapter calls it after every message-driven mutation;
   * GameRoom itself calls it after timer-driven transitions (countdown end,
   * grace-period removal).
   */
  persist?(snapshot: GameRoomSnapshot): void;
}

// ============================================================
// GameRoom
// ============================================================

export class GameRoom {
  // ---------- state ----------
  config: unknown = null;
  /** Pool metadata — sent to clients immediately on join, unlike the board config. */
  metadata: unknown = null;
  marks: Record<string, MarkEntry[]> = {};
  players: Record<string, PlayerInfo> = {};
  /** Player name -> identity code. Generated on first join, changeable by the player. */
  playerCodes: Record<string, string> = {};
  phase: GamePhase = "lobby";
  countdownEnd: number | null = null;
  mode: GameMode = "classic";
  lockout = false;
  countdownTimer: ReturnType<typeof setTimeout> | null = null;
  /** connId → player name */
  connPlayers = new Map<string, string>();
  /** Player names waiting out the reconnect grace period after a passive disconnect. */
  disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Player name → absolute timestamp when the reconnect grace period ends
   *  (mirrors disconnectTimers; persisted so evicted runtimes can still
   *  expire it). */
  disconnectDeadlines: Record<string, number> = {};
  bonusScores: Record<string, number> = {};
  /** Room owner — the player who first provided config. */
  owner: string | null = null;
  /** Hash of the original goal pool + pick rule — used to authorize restart. */
  configHash: string | null = null;
  /** Per-player star marks: player name -> set of cell indices. */
  starMarks: Record<string, Set<number>> = {};
  /** Per-player counter progress: player name -> { cell index -> value }. */
  counters: Record<string, Record<string, number>> = {};
  /** Per-player planning notes: player name -> ordered list. */
  notes: Record<string, PlayerNote[]> = {};
  /** Per-player unread-chat flag: player name -> has unseen chat. */
  unreadChat: Record<string, boolean> = {};
  /** Room chat history — replayed so no player ever misses a message. */
  chats: ChatRecord[] = [];
  /** Serial room timer queue — configured by the room owner. */
  timers: RoomTimer[] = [];
  /** Index of the current timer in `timers` (-1 when nothing is active). */
  timerIndex = -1;
  /** Overall state of the serial timer queue. */
  timerStatus: TimerStatus = "idle";
  /** Server-clock time (ms) when a running countdown reaches 0. */
  timerEndAt: number | null = null;
  /** Server-clock time (ms) when a running count-up segment started. */
  timerStartedAt: number | null = null;
  /** Seconds remaining on a paused (or just-finished) countdown. */
  timerPausedRemaining: number | null = null;
  /** Seconds elapsed on a paused (or just-finished) count-up. */
  timerPausedElapsed: number | null = null;
  /** Whether the queue auto-starts when the game starts. On by default for
   *  new rooms; the owner can turn it off in the queue setup dialog. */
  timerAutoStart = true;
  /** Auto-advance timer: fires when a running countdown reaches 0. */
  timerAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

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
      metadata: this.metadata,
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
      timer: this.timerState,
      serverTime: Date.now(),
    };
  }

  private get lobbyStateMsg(): ServerMsg & { type: "state" } {
    return {
      type: "state",
      config: null,
      metadata: this.metadata,
      marks: {},
      players: this.players,
      phase: this.phase,
      countdownSeconds: null,
      mode: this.mode,
      lockout: this.lockout,
      bonusScores: this.bonusScores,
      owner: this.owner,
      configHash: this.configHash,
      timer: this.timerState,
      serverTime: Date.now(),
    };
  }

  /**
   * Personal state message for a single connection: the shared room state
   * plus that player's own star marks and counter progress. Same-name
   * devices therefore start (or reconnect) with the same personal data.
   */
  private stateMsgFor(connId: string): ServerMsg & { type: "state" } {
    const base = this.phase === "lobby" ? this.lobbyStateMsg : this.stateMsg;
    const name = this.connPlayers.get(connId);
    if (!name) return base;
    // Always include the personal fields (empty after a restart) so clients
    // replace their local star/counter state with the server's version.
    return {
      ...base,
      myName: name,
      myCode: this.playerCodes[name] ?? null,
      myStars: this.starMarks[name] ? [...this.starMarks[name]!] : [],
      myCounters: this.counters[name] ? { ...this.counters[name]! } : {},
      myNotes: this.notes[name] ? this.notes[name]!.map((n) => ({ ...n })) : [],
      myUnreadChat: this.unreadChat[name] === true,
    };
  }

  /**
   * Send the initial (or reconnection) bundle: authoritative room state plus
   * the full chat history, so late joiners and players who were disconnected
   * mid-game never miss a message. New messages continue via live broadcasts.
   */
  private sendJoinState(connId: string): void {
    this.transport.send(connId, this.stateMsgFor(connId));
    this.transport.send(connId, {
      type: "chat_history",
      chats: this.chats.map((c) => ({ ...c })),
    });
  }

  /** Send a message only to connections registered under the given name. */
  private sendToSameName(
    name: string,
    msg: ServerMsg,
    excludeConnId?: string,
  ): void {
    for (const [connId, pname] of this.connPlayers) {
      if (pname === name && connId !== excludeConnId) {
        this.transport.send(connId, msg);
      }
    }
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
      this.finishCountdown();
      this.countdownTimer = null;
    }, 3000);
  }

  /** Complete a running countdown: enter playing and announce the start. */
  private finishCountdown(): void {
    this.phase = "playing";
    this.countdownEnd = null;
    for (const p of Object.values(this.players)) {
      delete p.ready;
    }
    this.transport.broadcast({ type: "start" });
    // Auto-start the room timer together with the game when the owner
    // enabled it (the timer_state broadcast follows the "start" one, so
    // clients see both transitions in order).
    this.autoStartTimerIfConfigured();
    // Timer-driven transition: persist so a runtime recycle right after
    // "start" restores the room as playing, not countdown.
    this.transport.persist?.(this.serialize());
  }

  // ---------- room timer ----------

  private get timerState(): RoomTimerState {
    return {
      timers: this.timers.map((t) => ({ ...t })),
      currentIndex: this.timerIndex,
      status: this.timerStatus,
      endAt: this.timerEndAt,
      startedAt: this.timerStartedAt,
      pausedRemaining: this.timerPausedRemaining,
      pausedElapsed: this.timerPausedElapsed,
      autoStart: this.timerAutoStart,
    };
  }

  /**
   * Broadcast the authoritative timer state. `serverTime` lets every client
   * (re-)estimate its offset to the server clock right when the timer
   * changes — this is what keeps all players' displays in sync despite
   * wrong local clocks or high network latency.
   */
  private broadcastTimerState(): void {
    this.transport.broadcast({
      type: "timer_state",
      ...this.timerState,
      serverTime: Date.now(),
    });
  }

  /** Reset the run: no current timer, status idle, all run fields cleared. */
  private clearTimerRun(): void {
    if (this.timerAdvanceTimer) {
      clearTimeout(this.timerAdvanceTimer);
      this.timerAdvanceTimer = null;
    }
    this.timerIndex = -1;
    this.timerStatus = "idle";
    this.timerEndAt = null;
    this.timerStartedAt = null;
    this.timerPausedRemaining = null;
    this.timerPausedElapsed = null;
  }

  /**
   * Start a fresh queue run when auto-start is enabled and the game starts.
   * Called from the game-start paths ("start"); runs the timer together with
   * the room without the owner pressing start. A run that is already running
   * or paused was started explicitly by the owner and is left alone.
   */
  private autoStartTimerIfConfigured(): void {
    if (!this.timerAutoStart || this.timers.length === 0) return;
    if (this.timerStatus === "running" || this.timerStatus === "paused") return;
    this.timerIndex = 0;
    this.timerPausedRemaining = null;
    this.timerPausedElapsed = null;
    this.startCurrentTimer();
    this.broadcastTimerState();
    this.transport.persist?.(this.serialize());
  }

  /**
   * Snapshot the current timer's remaining/elapsed seconds into the paused
   * fields. Called when pausing and when a timer ends, so a paused or
   * finished run can still display its last value.
   */
  private captureTimerValue(): void {
    const timer = this.timers[this.timerIndex];
    if (!timer) return;
    if (timer.mode === "countdown") {
      this.timerPausedRemaining =
        this.timerEndAt != null
          ? Math.max(0, Math.ceil((this.timerEndAt - Date.now()) / 1000))
          : (this.timerPausedRemaining ?? 0);
    } else {
      this.timerPausedElapsed =
        this.timerStartedAt != null
          ? Math.max(0, Math.floor((Date.now() - this.timerStartedAt) / 1000))
          : (this.timerPausedElapsed ?? 0);
    }
  }

  /** Start (or resume) the timer at `timerIndex` and arm auto-advance. */
  private startCurrentTimer(): void {
    const timer = this.timers[this.timerIndex];
    if (!timer) return;
    if (this.timerAdvanceTimer) {
      clearTimeout(this.timerAdvanceTimer);
      this.timerAdvanceTimer = null;
    }
    this.timerStatus = "running";
    if (timer.mode === "countdown") {
      // Resume uses the paused snapshot, a fresh start the full duration.
      const remaining = this.timerPausedRemaining ?? timer.duration;
      this.timerEndAt = Date.now() + remaining * 1000;
      this.timerStartedAt = null;
      this.timerPausedRemaining = null;
      this.timerPausedElapsed = null;
      this.timerAdvanceTimer = setTimeout(() => {
        this.timerAdvanceTimer = null;
        // The countdown has expired: clamp the deadline to "now" so the
        // captured remaining time is exactly 0 (ms rounding can otherwise
        // leave endAt a hair ahead and the finish snapshot shows 1s left).
        if (this.timerEndAt != null) {
          this.timerEndAt = Math.min(this.timerEndAt, Date.now());
        }
        // Countdown reached zero: auto-start the next timer (or finish).
        this.advanceTimer();
        this.transport.persist?.(this.serialize());
      }, remaining * 1000);
    } else {
      // Count-up: resume from the paused elapsed, else from 0. It never
      // ends on its own — only the owner's stop advances past it.
      const elapsed = this.timerPausedElapsed ?? 0;
      this.timerStartedAt = Date.now() - elapsed * 1000;
      this.timerEndAt = null;
      this.timerPausedRemaining = null;
      this.timerPausedElapsed = null;
    }
  }

  /**
   * End the current timer and move to the next one, or finish the run when
   * the queue is exhausted. Fired by the auto-advance timer (a countdown
   * reaching 0) and by the owner's stop control (count-up timers never end
   * on their own, so the owner stops them to advance).
   */
  private advanceTimer(): void {
    if (this.timerAdvanceTimer) {
      clearTimeout(this.timerAdvanceTimer);
      this.timerAdvanceTimer = null;
    }
    this.captureTimerValue();
    if (this.timerIndex < this.timers.length - 1) {
      this.timerIndex += 1;
      // Fresh start for the next timer — drop the previous one's snapshot.
      this.timerPausedRemaining = null;
      this.timerPausedElapsed = null;
      this.startCurrentTimer();
    } else {
      this.timerStatus = "finished";
      this.timerEndAt = null;
      this.timerStartedAt = null;
    }
    this.broadcastTimerState();
    this.transport.persist?.(this.serialize());
  }

  /** Freeze a running timer; resume later with the same remaining/elapsed. */
  private pauseTimer(): void {
    if (this.timerStatus !== "running") return;
    this.captureTimerValue();
    if (this.timerAdvanceTimer) {
      clearTimeout(this.timerAdvanceTimer);
      this.timerAdvanceTimer = null;
    }
    this.timerEndAt = null;
    this.timerStartedAt = null;
    this.timerStatus = "paused";
    this.broadcastTimerState();
    this.transport.persist?.(this.serialize());
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
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.disconnectDeadlines = {};
    this.config = null;
    this.metadata = null;
    this.phase = "lobby";
    this.marks = {};
    this.starMarks = {};
    this.counters = {};
    this.notes = {};
    this.unreadChat = {};
    this.playerCodes = {};
    this.chats = [];
    this.lockout = false;
    this.bonusScores = {};
    this.owner = null;
    this.configHash = null;
    this.timers = [];
    this.clearTimerRun();
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdownEnd = null;
  }

  // ---------- persistence ----------

  /** Capture everything needed to rebuild this room in a fresh runtime. */
  serialize(): GameRoomSnapshot {
    const starMarks: Record<string, number[]> = {};
    for (const [name, stars] of Object.entries(this.starMarks)) {
      starMarks[name] = [...stars];
    }
    return {
      config: this.config,
      metadata: this.metadata,
      mode: this.mode,
      lockout: this.lockout,
      marks: this.marks,
      players: this.players,
      phase: this.phase,
      countdownEnd: this.countdownEnd,
      bonusScores: this.bonusScores,
      owner: this.owner,
      configHash: this.configHash,
      starMarks,
      counters: this.counters,
      notes: this.notes,
      unreadChat: this.unreadChat,
      chats: this.chats,
      playerCodes: this.playerCodes,
      disconnectDeadlines: this.disconnectDeadlines,
      timers: this.timers,
      timerIndex: this.timerIndex,
      timerStatus: this.timerStatus,
      timerEndAt: this.timerEndAt,
      timerStartedAt: this.timerStartedAt,
      timerPausedRemaining: this.timerPausedRemaining,
      timerPausedElapsed: this.timerPausedElapsed,
      timerAutoStart: this.timerAutoStart,
    };
  }

  /**
   * Rebuild the room from a persisted snapshot. Called once right after the
   * runtime starts, before any connection is processed. Safe no-op when
   * players have already joined in the meantime.
   */
  restore(snapshot: GameRoomSnapshot): void {
    if (!snapshot || typeof snapshot !== "object") return;
    if (Object.keys(this.players).length > 0) return;

    this.config = snapshot.config ?? null;
    this.metadata = snapshot.metadata ?? null;
    this.mode = snapshot.mode === "hex" ? "hex" : "classic";
    this.lockout = snapshot.lockout === true;
    this.marks = snapshot.marks ?? {};
    this.players = snapshot.players ?? {};
    this.bonusScores = snapshot.bonusScores ?? {};
    this.owner = snapshot.owner ?? null;
    this.configHash = snapshot.configHash ?? null;
    this.playerCodes = snapshot.playerCodes ?? {};
    this.counters = snapshot.counters ?? {};
    this.notes = snapshot.notes ?? {};
    this.unreadChat = snapshot.unreadChat ?? {};
    this.chats = snapshot.chats ?? [];
    this.starMarks = {};
    for (const [name, stars] of Object.entries(snapshot.starMarks ?? {})) {
      this.starMarks[name] = new Set(stars);
    }

    // The fresh runtime has no live connections, so every restored player
    // starts (or continues) a reconnect grace window. Keep a persisted
    // deadline when one exists — an eviction must not reset the removal
    // clock, or a zombie player could live forever across repeated
    // evictions. Players without a deadline get a fresh window.
    this.disconnectDeadlines = { ...(snapshot.disconnectDeadlines ?? {}) };
    const now = Date.now();
    for (const name of Object.keys(this.players)) {
      const existing = this.disconnectDeadlines[name];
      const deadline =
        typeof existing === "number" && existing > now
          ? existing
          : now + RECONNECT_GRACE_MS;
      this.disconnectDeadlines[name] = deadline;
      this.armDisconnectTimer(name, deadline);
    }
    // Persist the restored deadlines right away: if the runtime is evicted
    // again before the next message/alarm, the deadlines must survive.
    this.transport.persist?.(this.serialize());

    // Restore the serial room timer. The run uses absolute server-clock
    // timestamps, so it can be rebuilt exactly: a running count-up keeps
    // counting from its start time (elapsed includes the offline time), a
    // running countdown gets its auto-advance timer re-armed. A countdown
    // whose deadline passed while the runtime was down advances once — the
    // next timer starts fresh (or the run finishes).
    this.timers = Array.isArray(snapshot.timers)
      ? snapshot.timers.map((t) => ({ ...t }))
      : [];
    this.timerIndex =
      Number.isInteger(snapshot.timerIndex) && (snapshot.timerIndex ?? -1) >= 0
        ? (snapshot.timerIndex ?? -1)
        : -1;
    const restoredStatus = snapshot.timerStatus;
    this.timerStatus =
      restoredStatus === "running" ||
      restoredStatus === "paused" ||
      restoredStatus === "finished"
        ? restoredStatus
        : "idle";
    this.timerEndAt =
      typeof snapshot.timerEndAt === "number" ? snapshot.timerEndAt : null;
    this.timerStartedAt =
      typeof snapshot.timerStartedAt === "number"
        ? snapshot.timerStartedAt
        : null;
    this.timerPausedRemaining =
      typeof snapshot.timerPausedRemaining === "number"
        ? snapshot.timerPausedRemaining
        : null;
    this.timerPausedElapsed =
      typeof snapshot.timerPausedElapsed === "number"
        ? snapshot.timerPausedElapsed
        : null;
    // Auto-start is on by default (a missing flag in older snapshots keeps
    // the default — disabled only when the owner explicitly turned it off).
    this.timerAutoStart = snapshot.timerAutoStart !== false;
    if (
      this.timerStatus === "running" &&
      (this.timerIndex < 0 || this.timerIndex >= this.timers.length)
    ) {
      this.clearTimerRun();
    } else if (
      this.timerStatus === "running" &&
      this.timerIndex >= 0 &&
      this.timerIndex < this.timers.length
    ) {
      const current = this.timers[this.timerIndex];
      if (current.mode === "countdown" && this.timerEndAt != null) {
        const wait = this.timerEndAt - Date.now();
        if (wait > 0) {
          this.timerAdvanceTimer = setTimeout(() => {
            this.timerAdvanceTimer = null;
            // Clamp the deadline to "now" so the finish snapshot reads 0
            // remaining (see startCurrentTimer for the same trick).
            if (this.timerEndAt != null) {
              this.timerEndAt = Math.min(this.timerEndAt, Date.now());
            }
            this.advanceTimer();
            this.transport.persist?.(this.serialize());
          }, wait);
        } else {
          this.advanceTimer();
          this.transport.persist?.(this.serialize());
        }
      }
      // Count-up: nothing to re-arm — the display derives from startedAt.
    }

    // Restore an in-flight countdown: re-arm the "start" timer when the
    // deadline is still ahead; otherwise the game should already be playing.
    if (snapshot.phase === "countdown") {
      if (snapshot.countdownEnd != null && snapshot.countdownEnd > Date.now()) {
        this.phase = "countdown";
        this.countdownEnd = snapshot.countdownEnd;
        this.countdownTimer = setTimeout(() => {
          this.finishCountdown();
          this.countdownTimer = null;
        }, snapshot.countdownEnd - Date.now());
        return;
      }
      this.phase = "playing";
      this.countdownEnd = null;
      for (const p of Object.values(this.players)) {
        delete p.ready;
      }
      // The game started while the runtime was down: honor auto-start the
      // same way finishCountdown would have.
      this.autoStartTimerIfConfigured();
      return;
    }

    this.phase = snapshot.phase === "playing" ? "playing" : "lobby";
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
        const { name, config, metadata, mode, lockout: cfgLockout, code } = msg;
        const cleanName = name.trim();
        if (!cleanName) return;

        // A reconnect during the grace period cancels the pending removal.
        this.cancelRemoval(cleanName);

        // Store config if this is the first player to provide one.
        // Config is already a compressed base64 string — server just
        // stores it as-is and forwards to clients without decompressing.
        if (config && !this.config) {
          this.config = config;
          if (metadata !== undefined) this.metadata = metadata;
          if (mode) this.mode = mode;
          if (cfgLockout !== undefined) this.lockout = cfgLockout;
          this.owner = cleanName;
          if (msg.configHash) this.configHash = msg.configHash;
        } else if (
          !this.owner &&
          typeof msg.configHash === "string" &&
          msg.configHash === this.configHash
        ) {
          // The previous owner is gone (left / kicked / removed as a zombie
          // after the reconnect grace expired). A joiner with the matching
          // config hash may take over so the room keeps restart/kick rights.
          this.owner = cleanName;
        }

        // Handle reconnect: player name already exists
        const existing = this.players[cleanName];
        if (existing) {
          // Only accept the join when the identity code matches: this covers
          // auto-reconnects from the same device and an intentional second
          // device of the same player. A wrong/missing code means a different
          // person is trying to use the name — reject so the client can offer
          // to rename or ask for the code.
          const providedCode = typeof code === "string" ? code.trim() : "";
          const storedCode = this.playerCodes[cleanName];
          if (storedCode && providedCode === storedCode) {
            this.connPlayers.set(connId, cleanName);
            this.sendJoinState(connId);
            return;
          }
          this.transport.send(connId, {
            type: "join_rejected",
            name: cleanName,
            // A missing code and a wrong code are the same error: the client
            // must present the correct identity code (or rename).
            reason: "bad_code",
          });
          return;
        }

        // Assign color and add player
        const color =
          this.mode === "hex" ? this.assignTeamColor() : this.assignColor();
        this.players[cleanName] = { name: cleanName, color };
        // Server generates a fresh 4-digit identity code and reports it via
        // the personal state message (myCode).
        this.playerCodes[cleanName] = String(
          Math.floor(1000 + Math.random() * 9000),
        );
        this.connPlayers.set(connId, cleanName);

        // Send state + full chat history to the new player
        this.sendJoinState(connId);

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
        // A pending removal timer for the old name is now meaningless.
        this.cancelRemoval(msg.oldName);
        // Update the mapping for every connection of this player, not just
        // the sender — same-name devices must keep receiving this player's
        // personal star/counter sync after the rename.
        for (const [cid, pname] of this.connPlayers) {
          if (pname === msg.oldName) this.connPlayers.set(cid, newName);
        }
        // Keep the player's personal data under their new name.
        if (this.starMarks[msg.oldName]) {
          this.starMarks[newName] = this.starMarks[msg.oldName];
          delete this.starMarks[msg.oldName];
        }
        if (this.counters[msg.oldName]) {
          this.counters[newName] = this.counters[msg.oldName];
          delete this.counters[msg.oldName];
        }
        if (this.notes[msg.oldName]) {
          this.notes[newName] = this.notes[msg.oldName];
          delete this.notes[msg.oldName];
        }
        if (this.unreadChat[msg.oldName]) {
          this.unreadChat[newName] = true;
          delete this.unreadChat[msg.oldName];
        }
        // The identity code belongs to the player, not the name — it follows
        // a rename so their other devices can keep joining under the new name.
        if (this.playerCodes[msg.oldName] !== undefined) {
          this.playerCodes[newName] = this.playerCodes[msg.oldName]!;
          delete this.playerCodes[msg.oldName];
        }
        // Room owner follows the rename so they keep restart rights.
        if (this.owner === msg.oldName) this.owner = newName;
        this.transport.broadcast(msg, [connId]);
        break;
      }

      case "change_code": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        if (typeof msg.code !== "string") return;
        const code = msg.code.trim();
        // Any non-empty string up to 32 chars: not necessarily numeric,
        // not necessarily 4 digits.
        if (!code || code.length > 32) return;
        this.playerCodes[playerName] = code;
        this.sendToSameName(
          playerName,
          { type: "code_changed", name: playerName, code },
          connId,
        );
        break;
      }

      case "ping": {
        // Heartbeat ack — keeps the connection alive through proxies with an
        // idle timeout (e.g. Cloudflare ~100s) without waking game logic.
        // The server timestamp (plus the echoed client send time) lets the
        // client estimate its clock offset for the shared room timer.
        this.transport.send(connId, {
          type: "pong",
          serverTime: Date.now(),
          ...(typeof msg.t === "number" ? { t: msg.t } : {}),
        });
        break;
      }

      case "leave": {
        // Explicit user exit (leave button / page close): remove right away,
        // unlike a passive disconnect which gets a reconnect grace period.
        const name = msg.name.trim();
        if (!name) return;
        if (this.connPlayers.get(connId) !== name) return;
        this.cancelRemoval(name);
        this.connPlayers.delete(connId);
        // Other same-name devices are still connected — keep the player.
        for (const [, pname] of this.connPlayers) {
          if (pname === name) return;
        }
        this.removePlayer(name);
        break;
      }

      case "kick": {
        // Only the room owner may remove a player. Removal is valid only for
        // a fully disconnected player: if the target still has any live
        // connection (a client that would answer heartbeats), the request is
        // rejected and nothing changes.
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        const target = msg.name.trim();
        if (!target || target === sender) return;
        if (!this.players[target]) return;
        for (const [, pname] of this.connPlayers) {
          if (pname === target) {
            this.transport.send(connId, {
              type: "kick_rejected",
              name: target,
              reason: "online",
            });
            return;
          }
        }
        this.removePlayer(target);
        break;
      }

      case "timer_submit": {
        // Only the room owner may (re)configure the timer queue.
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        const cleaned = sanitizeTimers(msg.timers);
        // Replace the queue. Deleting rows never disturbs a run unless the
        // currently running/paused timer itself is removed: the run carries
        // on, and its pointer follows the timer to its new position. Only
        // removing that timer — or submitting an empty list — ends the run.
        const currentId =
          this.timerIndex >= 0 && this.timerIndex < this.timers.length
            ? this.timers[this.timerIndex]!.id
            : null;
        this.timers = cleaned;
        const active =
          this.timerStatus === "running" || this.timerStatus === "paused";
        if (!active) {
          this.clearTimerRun();
        } else if (currentId != null) {
          const nextIndex = cleaned.findIndex((t) => t.id === currentId);
          if (nextIndex < 0) {
            // The running timer itself was deleted — the run cannot
            // continue; end it (idle, awaiting a fresh start).
            this.clearTimerRun();
          } else {
            // Keep the run going; re-point it at the timer's new position
            // so the display and the auto-advance follow the new queue.
            this.timerIndex = nextIndex;
          }
        } else {
          // No identifiable current timer — defensive reset.
          this.clearTimerRun();
        }
        // The submit carries the auto-start setting from the setup dialog.
        if (typeof msg.autoStart === "boolean") {
          this.timerAutoStart = msg.autoStart;
        }
        this.broadcastTimerState();
        this.transport.persist?.(this.serialize());
        break;
      }

      case "timer_start": {
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        if (this.timers.length === 0 || this.timerStatus === "running") return;
        if (this.timerStatus !== "paused") {
          // idle / finished: begin a fresh run from the first timer.
          this.timerIndex = 0;
          this.timerPausedRemaining = null;
          this.timerPausedElapsed = null;
        }
        // paused: resume the current timer with its snapshot.
        this.startCurrentTimer();
        this.broadcastTimerState();
        this.transport.persist?.(this.serialize());
        break;
      }

      case "timer_pause": {
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        this.pauseTimer();
        break;
      }

      case "timer_stop": {
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        if (this.timerStatus !== "running" && this.timerStatus !== "paused") {
          return;
        }
        // Truly stop the run: no current timer, status back to idle, the
        // queue itself survives so the owner can start a fresh run later.
        this.clearTimerRun();
        this.broadcastTimerState();
        this.transport.persist?.(this.serialize());
        break;
      }

      case "timer_next": {
        const sender = this.connPlayers.get(connId);
        if (!sender || sender !== this.owner) return;
        if (this.timerStatus !== "running" && this.timerStatus !== "paused") {
          return;
        }
        // Skip the current timer: end it and start the next one (or finish
        // the run when the queue is exhausted).
        this.advanceTimer();
        break;
      }

      case "chat": {
        // Store the message (server-authoritative timestamp) so late joiners
        // and reconnecting players get it via chat_history, then broadcast
        // it live to everyone already in the room.
        const record: ChatRecord = {
          name: msg.name,
          color: msg.color,
          text: msg.text,
          timestamp: Date.now(),
        };
        this.chats.push(record);
        this.transport.broadcast({ type: "chat", ...record }, [connId]);
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
            // Auto-start the room timer together with the game when enabled.
            this.autoStartTimerIfConfigured();
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
        // Re-randomized board: personal star/counter indices no longer
        // map to the same goals, so clear them too.
        this.starMarks = {};
        this.counters = {};
        // Planned routes refer to the old board — clear notes as well.
        this.notes = {};
        this.phase = "lobby";
        this.bonusScores = {};
        // End any running room timer (the queue itself survives, so the
        // host can reuse the same plan or overwrite it for the new game).
        this.clearTimerRun();

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

        // Broadcast new lobby state to all players, personalized per
        // connection so everyone also clears their star/counter state.
        for (const [connId] of this.connPlayers) {
          this.transport.send(connId, this.stateMsgFor(connId));
        }
        break;
      }

      case "toggle_star": {
        // Personal star marks are keyed by the player name in the message,
        // like chat/ready — no sender-identity check. Delivery is still
        // restricted to connections registered under that same name.
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        if (!Number.isInteger(msg.index) || msg.index < 0) return;
        const stars = (this.starMarks[playerName] ??= new Set<number>());
        if (msg.starred) stars.add(msg.index);
        else stars.delete(msg.index);
        this.sendToSameName(
          playerName,
          {
            type: "star",
            name: playerName,
            index: msg.index,
            starred: msg.starred,
          },
          connId,
        );
        break;
      }

      case "set_counter": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        if (!Number.isInteger(msg.index) || msg.index < 0) return;
        if (!Number.isInteger(msg.value) || msg.value < 0) return;
        const counters = (this.counters[playerName] ??= {});
        if (msg.value > 0) counters[String(msg.index)] = msg.value;
        else delete counters[String(msg.index)];
        this.sendToSameName(
          playerName,
          {
            type: "counter",
            name: playerName,
            index: msg.index,
            value: msg.value,
          },
          connId,
        );
        break;
      }

      case "set_chat_unread": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        if (msg.unread) this.unreadChat[playerName] = true;
        else delete this.unreadChat[playerName];
        this.sendToSameName(
          playerName,
          {
            type: "chat_unread",
            name: playerName,
            unread: msg.unread === true,
          },
          connId,
        );
        break;
      }

      case "add_note": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        const note = msg.note;
        if (!note || typeof note.id !== "string" || !note.id) return;
        if (typeof note.text !== "string" || note.text.length > 2000) return;
        const list = (this.notes[playerName] ??= []);
        const clean: PlayerNote = {
          id: note.id,
          text: note.text,
          todo: note.todo === true,
          done: note.done === true,
          ...sanitizeLinkedCells(note.linkedCells),
        };
        list.push(clean);
        this.sendToSameName(
          playerName,
          { type: "note_added", name: playerName, note: { ...clean } },
          connId,
        );
        break;
      }

      case "update_note": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        const list = this.notes[playerName];
        if (!list) return;
        const idx = list.findIndex((n) => n.id === msg.id);
        if (idx < 0) return;
        if (msg.text !== undefined && msg.text.length > 2000) return;
        const updated: PlayerNote = {
          ...list[idx],
          ...(msg.text !== undefined ? { text: msg.text } : {}),
          ...(msg.todo !== undefined ? { todo: msg.todo } : {}),
          ...(msg.done !== undefined ? { done: msg.done } : {}),
        };
        if (msg.linkedCells !== undefined) {
          const linked = sanitizeLinkedCells(msg.linkedCells);
          if (linked.linkedCells) updated.linkedCells = linked.linkedCells;
          else delete updated.linkedCells;
        }
        list[idx] = updated;
        this.sendToSameName(
          playerName,
          { type: "note_updated", name: playerName, note: { ...updated } },
          connId,
        );
        break;
      }

      case "delete_note": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        const list = this.notes[playerName];
        if (!list) return;
        const idx = list.findIndex((n) => n.id === msg.id);
        if (idx < 0) return;
        list.splice(idx, 1);
        this.sendToSameName(
          playerName,
          { type: "note_deleted", name: playerName, id: msg.id },
          connId,
        );
        break;
      }

      case "reorder_notes": {
        const playerName = msg.name;
        if (!this.players[playerName]) return;
        const list = this.notes[playerName];
        if (!list || !Array.isArray(msg.ids)) return;
        const ids = msg.ids;
        const idSet = new Set(ids);
        if (idSet.size !== list.length || !list.every((n) => idSet.has(n.id))) {
          return;
        }
        const byId = new Map(list.map((n) => [n.id, n]));
        this.notes[playerName] = ids
          .map((id) => byId.get(id))
          .filter((n): n is PlayerNote => n !== undefined);
        this.sendToSameName(
          playerName,
          { type: "notes_reordered", name: playerName, ids },
          connId,
        );
        break;
      }
    }
  }

  /** Called when a connection closes. */
  handleClose(connId: string): void {
    const name = this.connPlayers.get(connId);
    if (!name) return;

    this.connPlayers.delete(connId);

    // Still connected via another socket of the same player.
    for (const [, pname] of this.connPlayers) {
      if (pname === name) return;
    }

    // Passive disconnect: give the player a grace period to reconnect
    // (an explicit "leave" removes them immediately instead).
    this.scheduleRemoval(name);
  }

  /**
   * Cancel a pending delayed removal (player reconnected or renamed).
   */
  private cancelRemoval(name: string): void {
    const timer = this.disconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(name);
    }
    delete this.disconnectDeadlines[name];
  }

  /**
   * Start (or restart) the reconnect grace period for a player whose socket
   * closed without an explicit "leave". The deadline is persisted so an
   * evicted runtime can still expire it (see sweepExpiredDisconnects).
   */
  private scheduleRemoval(name: string): void {
    this.cancelRemoval(name);
    const deadline = Date.now() + RECONNECT_GRACE_MS;
    this.disconnectDeadlines[name] = deadline;
    this.armDisconnectTimer(name, deadline);
  }

  /** Arm the in-memory grace-expiry timer for a known deadline. */
  private armDisconnectTimer(name: string, deadline: number): void {
    this.disconnectTimers.set(
      name,
      setTimeout(() => {
        this.disconnectTimers.delete(name);
        this.removeIfExpired(name, deadline);
      }, Math.max(0, deadline - Date.now())),
    );
  }

  /**
   * Remove the player once their grace deadline has passed without a
   * reconnection. Persists so a runtime recycle doesn't revive the removed
   * player from an older snapshot.
   */
  private removeIfExpired(name: string, deadline: number): void {
    if (Date.now() < deadline) return;
    for (const [, pname] of this.connPlayers) {
      if (pname === name) return;
    }
    this.removePlayer(name);
    this.transport.persist?.(this.serialize());
  }

  /**
   * Remove players whose reconnect grace deadline has passed and who still
   * have no live connection. Called from the server's persistent alarm sweep:
   * a restarted runtime has no in-memory grace timers, so this is the only
   * path that can expire disconnects that happened before an eviction.
   * Returns true if any player was removed (the caller should persist).
   */
  sweepExpiredDisconnects(now: number): boolean {
    let changed = false;
    for (const [name, deadline] of Object.entries(this.disconnectDeadlines)) {
      if (now < deadline) continue;
      // Reconnected during the grace window? Keep the player.
      let online = false;
      for (const [, pname] of this.connPlayers) {
        if (pname === name) {
          online = true;
          break;
        }
      }
      if (online) continue;
      this.removePlayer(name);
      changed = true;
    }
    return changed;
  }

  /**
   * Remove a player and all of their connections immediately, broadcasting
   * the departure. Used by explicit "leave" and by grace-period expiry.
   */
  private removePlayer(name: string): void {
    const timer = this.disconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(name);
    }
    delete this.disconnectDeadlines[name];
    if (!this.players[name]) return;

    for (const [connId, pname] of this.connPlayers) {
      if (pname === name) this.connPlayers.delete(connId);
    }

    delete this.players[name];
    delete this.starMarks[name];
    delete this.counters[name];
    delete this.notes[name];
    delete this.unreadChat[name];
    delete this.playerCodes[name];
    // The owner must stay a real player: a removed owner (explicit leave,
    // kick, grace expiry) leaves the room ownerless; a later joiner with the
    // matching config hash takes over (see the join handler).
    if (this.owner === name) this.owner = null;
    this.transport.broadcast({ type: "player_left", name });

    // Destroy room when empty: reset all state so a late-joiner starts fresh.
    if (Object.keys(this.players).length === 0) {
      this.resetRoom();
      this.transport.onRoomEmpty();
    }
  }
}
