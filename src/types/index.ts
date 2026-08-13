export interface Player {
  name: string;
  color: string;
  ready?: boolean;
}

export interface MarkEntry {
  by: string;
  timestamp: number;
}

/** A personal planning note, synced only to same-name connections. */
export interface PlayerNote {
  id: string;
  text: string;
  /** When true the note is a todo item and shows a done checkbox. */
  todo: boolean;
  /** Completion state for todo notes. */
  done: boolean;
}

export interface ImageAttachment {
  /** SHA-256 hex digest — used as R2 storage key and dedup identifier. */
  hash: string;
  /** Original file name (display only). */
  filename: string;
  mimeType: string;
  /** Base64 data — present in local goal pools; stripped before WebSocket transmission. */
  data?: string;
}

/** One concrete variant of a goal. `values` is a name -> value map filling
 *  the named `{name}` placeholders in the goal text; `difficulty` / `counter`
 *  optionally override the base goal's values. Named keys let translated
 *  templates reorder placeholders without scrambling the values.
 *  `values_i18n` optionally provides per-language overrides, so a variant can
 *  fill each translated template with values in that language. */
export interface VariantDef {
  values: Record<string, string>;
  /** Per-language placeholder overrides, keyed by language code. */
  values_i18n?: Record<string, Record<string, string>>;
  difficulty?: number;
  counter?: number;
}

export type GoalItem =
  | string
  | {
      text: string;
      tooltip?: string;
      text_i18n?: Record<string, string>;
      tooltip_i18n?: Record<string, string>;
      difficulty?: number;
      group?: string | string[];
      globalGroup?: string | string[];
      counter?: number;
      images?: ImageAttachment[];
      /** Task variants - when present, the text uses named `{name}`
       *  placeholders and each variant fills them with its own values. */
      variants?: VariantDef[];
      /** Internal: shared id for expanded variants of one task, used only to
       *  keep variants mutually exclusive during picking. Never persisted. */
      variantGroup?: string;
    };

export function getGoalText(item: GoalItem, lang?: string): string {
  if (typeof item === "string") return item;
  if (lang && item.text_i18n?.[lang]) return item.text_i18n[lang];
  return item.text;
}

export function getGoalTooltip(
  item: GoalItem,
  lang?: string,
): string | undefined {
  if (typeof item === "string") return undefined;
  if (lang && item.tooltip_i18n?.[lang]) return item.tooltip_i18n[lang];
  return item.tooltip;
}

export function getGoalDifficulty(item: GoalItem): number | undefined {
  return typeof item === "string" ? undefined : item.difficulty;
}

export function getGoalGroup(item: GoalItem): string[] {
  if (typeof item === "string") return [];
  const eg = item.group;
  if (!eg) return [];
  return Array.isArray(eg) ? eg : [eg];
}

export function getGoalGlobalGroup(item: GoalItem): string[] {
  if (typeof item === "string") return [];
  const gg = item.globalGroup;
  if (!gg) return [];
  return Array.isArray(gg) ? gg : [gg];
}

/** Strip group / globalGroup from goals — only needed for goal selection, not in-game sync. */
export function stripGoalMeta(goals: GoalItem[]): GoalItem[] {
  return goals.map((g) => {
    if (typeof g === "string") return g;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { group, globalGroup, variants, variantGroup, ...rest } = g;
    return rest;
  });
}

export function getGoalCounter(item: GoalItem | undefined): number {
  if (!item || typeof item === "string") return 0;
  return item.counter ?? 0;
}

export function getGoalVariants(item: GoalItem): VariantDef[] {
  return typeof item === "string" ? [] : (item.variants ?? []);
}

export function hasGoalVariants(item: GoalItem): boolean {
  return getGoalVariants(item).length > 0;
}

export function getGoalImages(item: GoalItem): ImageAttachment[] {
  if (typeof item === "string") return [];
  return item.images ?? [];
}

/** Remove base64 data from images — keep only hash/filename/mimeType for wire transmission. */
export function stripAttachments(
  images: ImageAttachment[] | undefined,
): ImageAttachment[] | undefined {
  if (!images || images.length === 0) return images;
  let changed = false;
  const stripped = images.map(({ hash, filename, mimeType, data }) => {
    if (data) changed = true;
    return { hash, filename, mimeType };
  });
  return changed ? stripped : images;
}

export function stripImageData(goals: GoalItem[]): GoalItem[] {
  let changed = false;
  const result = goals.map((g) => {
    if (typeof g === "string" || !g.images || g.images.length === 0) return g;
    const stripped = stripAttachments(g.images);
    // Only strip if at least one image had data
    if (stripped !== g.images) {
      changed = true;
      return { ...g, images: stripped as ImageAttachment[] };
    }
    return g;
  });
  return changed ? result : goals;
}

/**
 * Strip image data from a BoardConfig or HexConfig before WebSocket transmission.
 * Both config types have an optional `goals: GoalItem[]` field.
 */
export function stripConfigImageData(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== "object") return cfg;
  const obj = cfg as Record<string, unknown>;
  if (!Array.isArray(obj.goals)) return cfg;
  const metadata = obj.metadata as PoolMetadata | undefined;
  const strippedImages = stripAttachments(metadata?.images);
  return {
    ...obj,
    goals: stripImageData(obj.goals as GoalItem[]),
    ...(metadata
      ? {
          metadata: {
            ...metadata,
            ...(strippedImages !== metadata.images
              ? { images: strippedImages }
              : {}),
          },
        }
      : {}),
  };
}

/** Pool-level metadata shared with the room: name, description and images. */
export interface PoolMetadata {
  name: string;
  description?: string;
  images?: ImageAttachment[];
}

export interface GoalPool {
  id: string;
  name: string;
  /** Optional human-readable description of the pool. */
  description?: string;
  /** Optional pool-level images (shown in the room via the info panel). */
  images?: ImageAttachment[];
  goals: GoalItem[];
  createdAt: number;
  updatedAt: number;
}

export interface BoardConfig {
  goals: GoalItem[];
  lockout?: boolean;
  scoringRule?: import("../scoring/types").ScoringRule;
  /** Task pool metadata (name / description / images) shown in the room. */
  metadata?: PoolMetadata;
  /** Full goal pool before random pick — preserved for restart (client-side only, not sent to server). */
  originalPool?: GoalItem[];
  /** Pick rule used to select goals — preserved for restart (client-side only, not sent to server). */
  pickRule?: import("../randomPicks/types").PickRule;
  /** Hash of originalPool + pickRule + scoringRule — sent to server to authorize restart. */
  configHash?: string;
}

export type GameMode = "classic" | "hex";

export type GamePhase = "lobby" | "countdown" | "playing";

export interface RoomConfig {
  gameMode: GameMode;
  roomName: string;
  playerName: string;
  boardConfig: BoardConfig;
  serverUrl: string;
  imageHost?: string;
  hexConfig?: import("../hex/hexTypes").HexConfig;
}

export interface ChatMessage {
  name: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface CommonStateFields {
  players: Record<string, Player>;
  localClientId: string | null;
  localPlayerName: string | null;
  chats: ChatMessage[];
  /** Room owner — follows renames so the owner keeps restart rights. */
  owner?: string | null;
}

export type CommonAction =
  | { type: "SET_CLIENT_ID"; clientId: string }
  | { type: "SET_LOCAL_PLAYER_NAME"; name: string }
  | { type: "REMOVE_PLAYER"; playerName: string }
  | { type: "CLEAR_SESSION" }
  | { type: "UPDATE_PLAYER_COLOR"; playerName: string; color: string }
  | { type: "RENAME_PLAYER"; oldName: string; newName: string }
  | { type: "ADD_CHAT"; msg: ChatMessage };

import type { HexConfig } from "../hex/hexTypes";

export interface GameState {
  mode: GameMode;
  config: BoardConfig | HexConfig | null;
  /** Whether the server has acknowledged this player with authoritative state. */
  connection: "connecting" | "connected";
  /** Pool metadata — available as soon as the player joins, before the board config. */
  metadata: PoolMetadata | null;
  marks: Record<number, MarkEntry[]>;
  /** Cell indices starred by the local player — synced across same-name devices. */
  stars: Set<number>;
  /** Counter progress per cell for the local player — synced across same-name devices. */
  counters: Record<number, number>;
  /** Personal planning notes — synced across same-name devices. */
  notes: PlayerNote[];
  /** Unread-chat flag — synced across same-name devices. */
  unreadChat: boolean;
  /** This player's identity code (server-generated; changeable in settings). */
  myCode: string | null;
  players: Record<string, Player>;
  localClientId: string | null;
  localPlayerName: string | null;
  chats: ChatMessage[];
  phase: GamePhase;
  countdownSeconds: number | null;
  bonusScores: Record<string, number>;
  /** Room owner — the player who first provided the board config. */
  owner: string | null;
}

export type GameAction =
  | { type: "SET_CLIENT_ID"; clientId: string }
  | { type: "SET_CONNECTED" }
  | { type: "SET_LOCAL_PLAYER_NAME"; name: string }
  | { type: "ADD_PLAYER"; playerName: string; color: string }
  | { type: "REMOVE_PLAYER"; playerName: string }
  | { type: "ADD_MARK"; index: number; by: string; timestamp: number }
  | { type: "REMOVE_MARK"; index: number; by: string }
  | { type: "SET_CELL_MARKS"; index: number; marks: MarkEntry[] | null }
  | {
      type: "SET_STATE";
      state: {
        config?: BoardConfig | HexConfig;
        metadata?: PoolMetadata | null;
        marks?: Record<number, MarkEntry[]>;
        players: Record<string, Player>;
        phase?: GamePhase;
        countdownSeconds?: number;
        /** 服务端权威模式：加入房间后以房主设置覆盖本地主页设置。 */
        mode?: GameMode;
        bonusScores?: Record<string, number>;
        owner?: string | null;
        /** Personal star marks (indices), sent only to the matching player. */
        stars?: number[];
        /** Personal counter progress, sent only to the matching player. */
        counters?: Record<number, number>;
        /** Personal planning notes, sent only to the matching player. */
        notes?: PlayerNote[];
        /** Personal unread-chat flag, sent only to the matching player. */
        unreadChat?: boolean;
        /** This connection's authoritative player name. */
        myName?: string;
        /** This player's identity code, sent only to the matching connection. */
        myCode?: string | null;
      };
    }
  | {
      type: "RENAME_REJECTED";
      yourName: string;
      players: Record<string, Player>;
    }
  | { type: "CODE_CHANGED"; name: string; code: string }
  | { type: "CLEAR_SESSION" }
  | { type: "UPDATE_PLAYER_COLOR"; playerName: string; color: string }
  | { type: "RENAME_PLAYER"; oldName: string; newName: string }
  | { type: "ADD_CHAT"; msg: ChatMessage }
  | { type: "SET_READY"; playerName: string; ready: boolean }
  | { type: "SET_PHASE"; phase: GamePhase; countdownSeconds?: number }
  | { type: "SET_BONUS_SCORE"; playerName: string; bonus: number }
  | { type: "APPLY_STAR"; index: number; starred: boolean }
  | { type: "APPLY_COUNTER"; index: number; value: number }
  | { type: "APPLY_CHAT_UNREAD"; unread: boolean }
  | { type: "SET_MY_CODE"; code: string | null }
  | { type: "SET_CHATS"; chats: ChatMessage[] }
  | { type: "ADD_NOTE"; note: PlayerNote }
  | { type: "UPDATE_NOTE"; id: string; note: PlayerNote }
  | { type: "DELETE_NOTE"; id: string }
  | { type: "REORDER_NOTES"; ids: string[] };

export type PlayerCallbackAction = Extract<
  GameAction,
  { type: "UPDATE_PLAYER_COLOR" | "RENAME_PLAYER" | "ADD_CHAT" }
>;

/** Messages received from the PartyServer. */
export type ServerMessage =
  | {
      type: "state";
      config: unknown;
      metadata?: PoolMetadata | null;
      marks: Record<string, MarkEntry[]>;
      players: Record<string, Player>;
      phase: GamePhase;
      countdownSeconds: number | null;
      /** 房主设定的棋盘模式，加入房间时以此为准。 */
      mode: GameMode;
      bonusScores: Record<string, number>;
      owner?: string | null;
      configHash?: string | null;
      /** Personal star marks (indices), present only in per-player state. */
      myStars?: number[];
      /** Personal counter progress, present only in per-player state. */
      myCounters?: Record<string, number>;
      /** Personal planning notes, present only in per-player state. */
      myNotes?: PlayerNote[];
      /** This connection's authoritative player name. */
      myName?: string;
      /** This player's identity code, present only in per-player state. */
      myCode?: string | null;
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
      players: Record<string, Player>;
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
  | {
      type: "chat";
      name: string;
      color: string;
      text: string;
      timestamp?: number;
    }
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
  | { type: "chat_history"; chats: ChatMessage[] }
  | { type: "pong" };

/** Messages sent to the PartyServer. */
export type ClientMessage =
  | {
      type: "join";
      name: string;
      /** Identity code proving this connection belongs to the same player. */
      code?: string;
      config?: unknown;
      metadata?: PoolMetadata;
      mode?: GameMode;
      lockout?: boolean;
      configHash?: string;
    }
  | { type: "change_code"; name: string; code: string }
  | { type: "mark"; index: number; by: string }
  | { type: "unmark"; index: number; by: string }
  | { type: "change_color"; name: string; color: string }
  | { type: "rename"; oldName: string; newName: string }
  | { type: "chat"; name: string; color: string; text: string }
  | { type: "ready"; name: string; ready: boolean }
  | { type: "bonus_score"; playerName: string; bonus: number }
  | { type: "restart"; config?: unknown; configHash?: string }
  | { type: "toggle_star"; name: string; index: number; starred: boolean }
  | { type: "set_counter"; name: string; index: number; value: number }
  | { type: "add_note"; name: string; note: PlayerNote }
  | { type: "set_chat_unread"; name: string; unread: boolean }
  | { type: "ping" }
  | { type: "leave"; name: string }
  | { type: "kick"; name: string }
  | {
      type: "update_note";
      name: string;
      id: string;
      text?: string;
      todo?: boolean;
      done?: boolean;
    }
  | { type: "delete_note"; name: string; id: string }
  | { type: "reorder_notes"; name: string; ids: string[] };
