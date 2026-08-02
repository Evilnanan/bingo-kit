import type { GoalItem } from "../types";

export const HEX_MIN_SIZE = 2;
export const HEX_MAX_SIZE = 9;

export interface HexConfig {
  sizeBlue: number;
  sizeRed: number;
  goals: GoalItem[];
  /** Task pool metadata (name / description / images) shown in the room. */
  metadata?: import("../types").PoolMetadata;
  /** Hash of the original goal pool + board size — sent to server to authorize restart. */
  configHash?: string;
}
