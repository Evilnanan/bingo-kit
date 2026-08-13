import type { GoalItem } from "../types";

export const HEX_MIN_SIZE = 2;
export const HEX_MAX_SIZE = 9;

export interface HexConfig {
  sizeBlue: number;
  sizeRed: number;
  goals: GoalItem[];
  /** Goal pool metadata (name / description / images) shown in the room. */
  metadata?: import("../types").PoolMetadata;
  /** Full goal pool before random pick — preserved for restart (client-side only, not sent to server). */
  originalPool?: GoalItem[];
  /** Hash of the original goal pool + board size — sent to server to authorize restart. */
  configHash?: string;
}
