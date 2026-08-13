export { pureRandom } from "./algorithms/pureRandom";
export { balancedDifficulty } from "./algorithms/balanced";
export { pattern } from "./algorithms/pattern";
export { fixed } from "./algorithms/fixed";
export {
  expandVariants,
  countPlaceholders,
  listPlaceholders,
  hasAnonymousPlaceholder,
  fillTemplate,
} from "./variants";
export type { BalancedConfig, PatternResult, PickRule } from "./types";

import { pureRandom } from "./algorithms/pureRandom";
import { balancedDifficulty } from "./algorithms/balanced";
import { pattern } from "./algorithms/pattern";
import { fixed } from "./algorithms/fixed";
import type { PickRule } from "./types";
import type { GoalItem } from "../types";

export function pickGoals(pool: GoalItem[], rule: PickRule): GoalItem[] {
  // Each algorithm expands variants itself: every variant becomes a concrete
  // goal carrying an internal variantGroup id, so no two variants of the same
  // goal can be picked onto the same board.
  switch (rule.algorithm) {
    case "pure":
      return pureRandom(pool);
    case "fixed":
      return fixed(pool);
    case "balanced":
      return balancedDifficulty(pool, {
        minDifficulty: rule.minDifficulty,
        maxDifficulty: rule.maxDifficulty,
        centerHardest: rule.centerHardest,
      });
    case "pattern": {
      const pat = rule.pattern.split(",").map((s) => {
        const n = parseInt(s.trim(), 10);
        return isNaN(n) ? 1 : Math.max(1, Math.min(5, n));
      });
      while (pat.length < 5) pat.push(1);
      return pattern(pool, pat.slice(0, 5)).board;
    }
  }
}
