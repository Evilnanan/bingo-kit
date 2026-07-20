import type { GoalItem } from "../../types";

/** Take the first 25 goals in order — no randomization, no constraint checking. */
export function fixed(pool: GoalItem[]): GoalItem[] {
  return pool.slice(0, 25);
}
