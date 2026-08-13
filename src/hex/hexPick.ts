import type { GoalItem } from "../types";
import { getGoalGlobalGroup } from "../types";
import { expandVariants, getVariantGroupId } from "../randomPicks/variants";

/**
 * Randomly pick `count` goals for a hex board from a pool.
 *
 * Same algorithm as room creation: expand variants, shuffle the pool, then
 * take goals while skipping any that share a globalGroup (or a variant group)
 * with an already-picked goal, so the board never contains two goals from the
 * same group and never two variants of the same goal.
 */
export function pickHexGoals(pool: GoalItem[], count: number): GoalItem[] {
  const expanded = expandVariants(pool);
  const shuffled = [...expanded].sort(() => Math.random() - 0.5);
  const usedGlobal = new Set<string>();
  const usedVariants = new Set<string>();
  const picked: GoalItem[] = [];
  for (const g of shuffled) {
    if (picked.length >= count) break;
    const vg = getVariantGroupId(g);
    if (vg && usedVariants.has(vg)) continue;
    const ggs = getGoalGlobalGroup(g);
    if (ggs.some((gg) => usedGlobal.has(gg))) continue;
    picked.push(g);
    if (vg) usedVariants.add(vg);
    for (const gg of ggs) usedGlobal.add(gg);
  }
  return picked;
}
