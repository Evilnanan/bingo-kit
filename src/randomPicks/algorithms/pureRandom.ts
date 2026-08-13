import type { GoalItem } from "../../types";
import { shuffle, getGlobalExcl, canPlace } from "../utils";
import { expandVariants, getVariantGroupId } from "../variants";

/** Greedy placement with constraint checking, falling back to relaxed
 *  global-group constraint if the board can't be filled. Variant groups are
 *  always exclusive, even in the relaxed fallback. */
export function pureRandom(pool: GoalItem[]): GoalItem[] {
  const expanded = expandVariants(pool);
  let board = tryFillBoard(expanded, true);
  if (board) return board;
  board = tryFillBoard(expanded, false);
  return board || fallbackFill(expanded);
}

/** Last-resort fill: shuffle and take 25 items, skipping variant duplicates. */
function fallbackFill(pool: GoalItem[]): GoalItem[] {
  const usedVariants = new Set<string>();
  const board: GoalItem[] = [];
  for (const g of shuffle(pool)) {
    if (board.length >= 25) break;
    const vg = getVariantGroupId(g);
    if (vg && usedVariants.has(vg)) continue;
    board.push(g);
    if (vg) usedVariants.add(vg);
  }
  return board;
}

function tryFillBoard(
  pool: GoalItem[],
  strictGlobal: boolean,
): GoalItem[] | null {
  const board: (GoalItem | null)[] = Array(25).fill(null);
  const used = new Set<number>();
  const usedGlobal = new Set<string>();
  const usedVariants = new Set<string>();
  const positions = shuffle(Array.from({ length: 25 }, (_, i) => i));

  for (const pos of positions) {
    const indices = shuffle(
      Array.from({ length: pool.length }, (_, i) => i).filter(
        (i) => !used.has(i),
      ),
    );
    let placed = false;

    for (const gi of indices) {
      const g = pool[gi];
      const vg = getVariantGroupId(g);
      if (vg && usedVariants.has(vg)) continue;
      const gg = getGlobalExcl(g);
      if (strictGlobal && gg.some((x) => usedGlobal.has(x))) continue;
      if (!canPlace(g, pos, board, usedGlobal, usedVariants)) continue;

      board[pos] = g;
      used.add(gi);
      if (vg) usedVariants.add(vg);
      for (const ggg of gg) usedGlobal.add(ggg);
      placed = true;
      break;
    }

    if (!placed) return null;
  }

  return board.filter((g): g is GoalItem => g !== null);
}
