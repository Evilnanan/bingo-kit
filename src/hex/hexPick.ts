import type { GoalItem } from "../types";
import { getGoalGlobalGroup } from "../types";

/**
 * Randomly pick `count` goals for a hex board from a pool.
 *
 * Same algorithm as room creation: shuffle the pool, then take goals while
 * skipping any that share a globalGroup with an already-picked goal, so the
 * board never contains two goals from the same global group.
 */
export function pickHexGoals(pool: GoalItem[], count: number): GoalItem[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const usedGlobal = new Set<string>();
  const picked: GoalItem[] = [];
  for (const g of shuffled) {
    if (picked.length >= count) break;
    const ggs = getGoalGlobalGroup(g);
    if (ggs.some((gg) => usedGlobal.has(gg))) continue;
    picked.push(g);
    for (const gg of ggs) usedGlobal.add(gg);
  }
  return picked;
}
