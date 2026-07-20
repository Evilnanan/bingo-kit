import type { GoalItem } from "../../types";
import { shuffle, getGlobalExcl, canPlace } from "../utils";

/** Greedy placement with constraint checking, falling back to relaxed
 *  global-group constraint if the board can't be filled. */
export function pureRandom(pool: GoalItem[]): GoalItem[] {
  let board = tryFillBoard(pool, true);
  if (board) return board;
  board = tryFillBoard(pool, false);
  return board || shuffle(pool).slice(0, 25);
}

function tryFillBoard(
  pool: GoalItem[],
  strictGlobal: boolean,
): GoalItem[] | null {
  const board: (GoalItem | null)[] = Array(25).fill(null);
  const used = new Set<number>();
  const usedGlobal = new Set<string>();
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
      const gg = getGlobalExcl(g);
      if (strictGlobal && gg.some((g) => usedGlobal.has(g))) continue;
      if (!canPlace(g, pos, board, usedGlobal)) continue;

      board[pos] = g;
      used.add(gi);
      for (const ggg of gg) usedGlobal.add(ggg);
      placed = true;
      break;
    }

    if (!placed) return null;
  }

  return board.filter((g): g is GoalItem => g !== null);
}
