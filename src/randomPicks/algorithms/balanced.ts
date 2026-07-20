import type { GoalItem } from "../../types";
import type { BalancedConfig } from "../types";
import {
  shuffle,
  getDifficulty,
  getGlobalExcl,
  getExcl,
  canPlace,
  linesFor,
  LINES,
  lineSum,
} from "../utils";

/* ── global scoring ───────────────────────────────────────────────── */

function boardStdDev(board: GoalItem[]): number {
  const sums = LINES.map((l) =>
    l.reduce((s, i) => s + getDifficulty(board[i]), 0),
  );
  const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
  return Math.sqrt(sums.reduce((a, b) => a + (b - mean) ** 2, 0) / sums.length);
}

/* ── swap constraint check ────────────────────────────────────────── */

function canSwap(board: GoalItem[], a: number, b: number): boolean {
  const aGroups = getExcl(board[a]);
  const bGroups = getExcl(board[b]);
  if (aGroups.length === 0 && bGroups.length === 0) return true;

  for (const line of linesFor(b)) {
    for (const idx of line) {
      if (idx === a || idx === b) continue;
      const other = board[idx];
      if (other && aGroups.some((eg) => getExcl(other).includes(eg)))
        return false;
    }
  }

  for (const line of linesFor(a)) {
    for (const idx of line) {
      if (idx === a || idx === b) continue;
      const other = board[idx];
      if (other && bGroups.some((eg) => getExcl(other).includes(eg)))
        return false;
    }
  }

  return true;
}

/* ── swap optimization ────────────────────────────────────────────── */

function optimizeSwaps(
  board: GoalItem[],
  iterations: number,
  locked: Set<number>,
): void {
  let bestStd = boardStdDev(board);

  for (let iter = 0; iter < iterations; iter++) {
    // 80% random swaps, 20% targeted (highest vs lowest line)
    let a: number;
    let b: number;

    if (Math.random() < 0.2) {
      // Targeted: pick cells from the hottest and coldest lines
      const sums = LINES.map((l, li) => ({
        li,
        sum: l.reduce((s, i) => s + getDifficulty(board[i]), 0),
      }));
      const hi = sums.reduce((a, b) => (a.sum > b.sum ? a : b));
      const lo = sums.reduce((a, b) => (a.sum < b.sum ? a : b));
      a = LINES[hi.li][Math.floor(Math.random() * 5)];
      b = LINES[lo.li][Math.floor(Math.random() * 5)];
    } else {
      a = Math.floor(Math.random() * 25);
      b = Math.floor(Math.random() * 25);
    }

    if (a === b || locked.has(a) || locked.has(b)) continue;
    if (!canSwap(board, a, b)) continue;

    const tmp = board[a];
    board[a] = board[b];
    board[b] = tmp;

    const newStd = boardStdDev(board);
    if (newStd < bestStd) {
      bestStd = newStd;
    } else {
      board[b] = board[a];
      board[a] = tmp;
    }
  }
}

/* ── greedy fill ──────────────────────────────────────────────────── */

function greedyFill(
  candidates: GoalItem[],
  config: BalancedConfig,
): GoalItem[] {
  const board: (GoalItem | null)[] = Array(25).fill(null);
  const used = new Set<number>();
  const usedGlobal = new Set<string>();

  // Place hardest in center
  if (config.centerHardest) {
    // Pick the maximum difficulty among valid candidates, then randomly choose one.
    let maxD = 0;
    const hardest: { g: GoalItem; i: number }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      if (!canPlace(candidates[i], 12, board, usedGlobal)) continue;
      const d = getDifficulty(candidates[i]);
      if (d > maxD) {
        maxD = d;
        hardest.length = 0;
      }
      if (d === maxD) hardest.push({ g: candidates[i], i });
    }
    if (hardest.length > 0) {
      const pick = hardest[Math.floor(Math.random() * hardest.length)];
      board[12] = pick.g;
      used.add(pick.i);
      for (const ggg of getGlobalExcl(pick.g)) usedGlobal.add(ggg);
    }
  }

  const remaining = shuffle(
    Array.from({ length: 25 }, (_, i) => i).filter((i) => board[i] === null),
  );

  for (const pos of remaining) {
    const sample = shuffle(
      candidates
        .map((g, i) => ({ g, i }))
        .filter(
          ({ i, g }) => !used.has(i) && canPlace(g, pos, board, usedGlobal),
        ),
    ).slice(0, 15);

    let best: { g: GoalItem; idx: number; var: number } | null = null;
    for (const { g, i: ci } of sample) {
      board[pos] = g;
      const sums = linesFor(pos).map((line) => lineSum(board, line));
      const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
      const variance =
        sums.reduce((a, b) => a + (b - mean) ** 2, 0) / sums.length;
      if (!best || variance < best.var) best = { g, idx: ci, var: variance };
      board[pos] = null;
    }

    if (best) {
      board[pos] = best.g;
      used.add(best.idx);
      for (const ggg of getGlobalExcl(best.g)) usedGlobal.add(ggg);
    } else {
      const fallback = candidates.find(
        (g, i) => !used.has(i) && canPlace(g, pos, board, usedGlobal),
      );
      if (fallback) {
        board[pos] = fallback;
        used.add(candidates.indexOf(fallback));
        for (const ggg of getGlobalExcl(fallback)) usedGlobal.add(ggg);
      }
    }
  }

  // Fill remaining nulls
  for (let i = 0; i < 25; i++) {
    if (board[i] === null) {
      const fill = candidates.find((_g, j) => !used.has(j));
      if (fill) {
        board[i] = fill;
        used.add(candidates.indexOf(fill));
      }
    }
  }

  return board.filter((g): g is GoalItem => g !== null);
}

/* ── public API ───────────────────────────────────────────────────── */

export function balancedDifficulty(
  pool: GoalItem[],
  config: BalancedConfig,
): GoalItem[] {
  let candidates = pool.filter((g) => {
    const d = getDifficulty(g);
    return d >= config.minDifficulty && d <= config.maxDifficulty;
  });
  if (candidates.length < 25) candidates = [...pool];
  if (candidates.length < 25) {
    throw new Error(`任务池不足（${candidates.length} < 25），无法生成棋盘`);
  }

  const swapIterations = Math.max(800, candidates.length * 30);
  const locked = config.centerHardest ? new Set([12]) : new Set<number>();

  // Multiple restarts: run greedy + swap N times, keep the best board
  const RESTARTS = 3;
  let bestBoard: GoalItem[] | null = null;
  let bestStd = Infinity;

  for (let r = 0; r < RESTARTS; r++) {
    const board = greedyFill(candidates, config);
    optimizeSwaps(board, swapIterations, locked);
    const std = boardStdDev(board);
    if (std < bestStd) {
      bestStd = std;
      bestBoard = board;
    }
  }

  return bestBoard!;
}
