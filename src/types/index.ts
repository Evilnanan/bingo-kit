export interface Player {
  name: string;
  color: string;
  ready?: boolean;
}

export interface MarkEntry {
  by: string;
  timestamp: number;
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
    const { group, globalGroup, ...rest } = g;
    return rest;
  });
}

export function getGoalCounter(item: GoalItem | undefined): number {
  if (!item || typeof item === "string") return 0;
  return item.counter ?? 0;
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
  /** Pool metadata — available as soon as the player joins, before the board config. */
  metadata: PoolMetadata | null;
  marks: Record<number, MarkEntry[]>;
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
      };
    }
  | {
      type: "RENAME_REJECTED";
      yourName: string;
      players: Record<string, Player>;
    }
  | { type: "CLEAR_SESSION" }
  | { type: "UPDATE_PLAYER_COLOR"; playerName: string; color: string }
  | { type: "RENAME_PLAYER"; oldName: string; newName: string }
  | { type: "ADD_CHAT"; msg: ChatMessage }
  | { type: "SET_READY"; playerName: string; ready: boolean }
  | { type: "SET_PHASE"; phase: GamePhase; countdownSeconds?: number }
  | { type: "SET_BONUS_SCORE"; playerName: string; bonus: number };

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
    }
  | {
      type: "rename_rejected";
      yourName: string;
      players: Record<string, Player>;
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

/** Messages sent to the PartyServer. */
export type ClientMessage =
  | {
      type: "join";
      name: string;
      config?: unknown;
      metadata?: PoolMetadata;
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
