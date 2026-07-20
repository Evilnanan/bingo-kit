import type { GoalItem } from "../types";

export const HEX_MIN_SIZE = 2;
export const HEX_MAX_SIZE = 9;

export interface HexConfig {
  sizeBlue: number;
  sizeRed: number;
  goals: GoalItem[];
  /** Hash of the original goal pool + board size — sent to server to authorize restart. */
  configHash?: string;
}
