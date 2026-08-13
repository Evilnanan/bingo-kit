import type { GoalItem } from "../../types";
import { expandVariants, getVariantGroupId } from "../variants";

/** Take the first 25 goals in order — no randomization, no constraint
 *  checking. Variants of the same goal stay mutually exclusive: the first
 *  variant encountered in pool order wins. */
export function fixed(pool: GoalItem[]): GoalItem[] {
  const expanded = expandVariants(pool);
  const board: GoalItem[] = [];
  const usedVariants = new Set<string>();
  for (const g of expanded) {
    if (board.length >= 25) break;
    const vg = getVariantGroupId(g);
    if (vg && usedVariants.has(vg)) continue;
    board.push(g);
    if (vg) usedVariants.add(vg);
  }
  return board;
}
