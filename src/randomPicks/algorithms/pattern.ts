import type { GoalItem } from "../../types";
import type { PatternResult } from "../types";
import {
  shuffle,
  getDifficulty,
  getExcl,
  getGlobalExcl,
  canPlace,
  linesFor,
  LINES,
  POSITION_LINES,
} from "../utils";
import { expandVariants, getVariantGroupId } from "../variants";
import { PoolPickError } from "../errors";

/* ===================== grid layout ===================== */

function buildSequenceGridFormula(pattern: number[]): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const row: number[] = [];
    for (let j = 0; j < 5; j++) {
      row.push(pattern[(i + 2 * j) % 5]);
    }
    grid.push(row);
  }
  return grid;
}

function buildSequenceGrid(pattern: number[]): {
  grid: number[][] | null;
  attempts: number;
} {
  const patternCounts = new Map<number, number>();
  for (const d of pattern) {
    patternCounts.set(d, (patternCounts.get(d) || 0) + 1);
  }
  const uniqueDiffs = [...new Set(pattern)];

  const lineCounts: Map<number, number>[] = Array.from(
    { length: LINES.length },
    () => new Map(),
  );
  const grid: number[] = Array(25).fill(0);
  const positions = shuffle(Array.from({ length: 25 }, (_, i) => i));

  let attempts = 0;
  const MAX_ATTEMPTS = 200000;

  function isValid(pos: number, diff: number): boolean {
    for (const li of POSITION_LINES[pos]) {
      const cur = lineCounts[li].get(diff) || 0;
      if (cur >= (patternCounts.get(diff) || 0)) return false;
    }
    return true;
  }

  function backtrack(idx: number): boolean {
    if (idx === 25) return true;
    if (++attempts > MAX_ATTEMPTS) return false;

    const pos = positions[idx];
    const candidates = shuffle([...uniqueDiffs]);

    for (const diff of candidates) {
      if (!isValid(pos, diff)) continue;

      grid[pos] = diff;
      for (const li of POSITION_LINES[pos]) {
        lineCounts[li].set(diff, (lineCounts[li].get(diff) || 0) + 1);
      }

      if (backtrack(idx + 1)) return true;

      for (const li of POSITION_LINES[pos]) {
        const c = lineCounts[li].get(diff)!;
        if (c === 1) lineCounts[li].delete(diff);
        else lineCounts[li].set(diff, c - 1);
      }
    }

    return false;
  }

  const success = backtrack(0);

  if (!success) return { grid: null, attempts };

  const result: number[][] = [];
  for (let i = 0; i < 5; i++) {
    result.push(grid.slice(i * 5, (i + 1) * 5));
  }
  return { grid: result, attempts };
}

/* ===================== backtracking goal assignment ===================== */

function fillByBacktrack(
  pool: GoalItem[],
  grid: number[][],
):
  | {
      board: (GoalItem | null)[];
      relaxed: Set<number>;
      attempts: number;
      diag: NonNullable<PatternResult["backtrackDiag"]>;
    }
  | { diag: NonNullable<PatternResult["backtrackDiag"]> } {
  const MAX_ATTEMPTS = 1e5;
  const MAX_RETRIES = 20;

  const diag: NonNullable<PatternResult["backtrackDiag"]> & {
    retries: number;
  } = {
    maxDepth: 0,
    conflictJumps: 0,
    deadEnds: 0,
    skipBacks: 0,
    exhausted: false,
    hitLimit: false,
    retries: 0,
  };

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    diag.retries = retry;

    let attempts = 0;
    const board: (GoalItem | null)[] = Array(25).fill(null);
    const used = new Set<number>();
    const usedGlobal = new Set<string>();
    const usedVariants = new Set<string>();
    const relaxed = new Set<number>();
    const positions = shuffle(Array.from({ length: 25 }, (_, i) => i));
    const stack: { pos: number; g: GoalItem; idx: number }[] = [];

    function place(pos: number, g: GoalItem, idx: number) {
      board[pos] = g;
      used.add(idx);
      const vg = getVariantGroupId(g);
      if (vg) usedVariants.add(vg);
      for (const gg of getGlobalExcl(g)) usedGlobal.add(gg);
      stack.push({ pos, g, idx });
    }

    function unplace() {
      const last = stack.pop()!;
      board[last.pos] = null;
      used.delete(last.idx);
      const vg = getVariantGroupId(last.g);
      if (vg) usedVariants.delete(vg);
      for (const gg of getGlobalExcl(last.g)) usedGlobal.delete(gg);
    }

    function tempState(ignoreCount: number) {
      const tBoard: (GoalItem | null)[] = Array(25).fill(null);
      const tGlobal = new Set<string>();
      const tVariants = new Set<string>();
      const limit = stack.length - ignoreCount;
      for (let j = 0; j < limit; j++) {
        const p = stack[j];
        tBoard[p.pos] = p.g;
        for (const gg of getGlobalExcl(p.g)) tGlobal.add(gg);
        const vg = getVariantGroupId(p.g);
        if (vg) tVariants.add(vg);
      }
      return { tBoard, tGlobal, tVariants };
    }

    function canPlaceTemp(
      g: GoalItem,
      pos: number,
      tBoard: (GoalItem | null)[],
      tGlobal: Set<string>,
      tVariants: Set<string>,
    ): boolean {
      const vg = getVariantGroupId(g);
      if (vg && tVariants.has(vg)) return false;
      for (const gg of getGlobalExcl(g)) {
        if (tGlobal.has(gg)) return false;
      }
      const groups = getExcl(g);
      if (groups.length === 0) return true;
      for (const line of linesFor(pos)) {
        for (const idx of line) {
          const other = tBoard[idx];
          if (other && groups.some((eg) => getExcl(other).includes(eg)))
            return false;
        }
      }
      return true;
    }

    function getCandidates(
      pos: number,
      target: number,
      ignoreCount: number,
    ): { candidates: { g: GoalItem; idx: number }[]; range: number } | null {
      const { tBoard, tGlobal, tVariants } = tempState(ignoreCount);
      const freedIndices = new Set<number>();
      if (ignoreCount > 0) {
        for (let j = stack.length - ignoreCount; j < stack.length; j++) {
          freedIndices.add(stack[j].idx);
        }
      }

      let diffCandidates: { g: GoalItem; idx: number }[] | null = null;
      let usedRange = -1;
      for (let range = 0; range <= 4; range++) {
        const minD = Math.max(1, target - range);
        const maxD = Math.min(5, target + range);
        const cs: { g: GoalItem; idx: number }[] = [];
        for (let i = 0; i < pool.length; i++) {
          if (used.has(i) && !freedIndices.has(i)) continue;
          const d = getDifficulty(pool[i]);
          if (d >= minD && d <= maxD) cs.push({ g: pool[i], idx: i });
        }
        if (cs.length > 0) {
          diffCandidates = cs;
          usedRange = range;
          break;
        }
      }

      if (diffCandidates === null) return null;

      const valid = diffCandidates.filter(({ g }) =>
        canPlaceTemp(g, pos, tBoard, tGlobal, tVariants),
      );
      return { candidates: valid, range: usedRange };
    }

    function backtrack(idx: number): number | true {
      if (idx === 25) return true;
      if (++attempts > MAX_ATTEMPTS) {
        diag.hitLimit = true;
        return -1;
      }
      if (idx > diag.maxDepth) diag.maxDepth = idx;

      const pos = positions[idx];
      const target = grid[Math.floor(pos / 5)][pos % 5];

      const info = getCandidates(pos, target, 0);
      if (info === null) throw new PoolPickError("pattern_unfillable");

      let { candidates } = info;
      const { range } = info;

      if (candidates.length === 0) {
        diag.deadEnds++;
        let diagIgnore: number;
        for (diagIgnore = 1; diagIgnore <= stack.length; diagIgnore++) {
          const diagCand = getCandidates(pos, target, diagIgnore);
          if (diagCand === null) throw new PoolPickError("pattern_sequence");
          if (diagCand.candidates.length > 0) {
            candidates = diagCand.candidates;
            break;
          }
        }
        if (candidates.length === 0) {
          throw new PoolPickError("pattern_sequence");
        }
        diag.conflictJumps++;
        return stack.length - diagIgnore;
      }

      const isRelaxed = range > 0;
      if (isRelaxed) relaxed.add(pos);

      for (const { g, idx: gi } of shuffle(candidates)) {
        place(pos, g, gi);
        const result = backtrack(idx + 1);
        if (result === true) return true;
        unplace();
        if (typeof result === "number" && result < idx) return result;
      }

      if (isRelaxed) relaxed.delete(pos);

      diag.skipBacks++;
      for (let j = stack.length - 1; j >= 0; j--) {
        const g = stack[j].g;
        if (getExcl(g).length > 0 || getGlobalExcl(g).length > 0) return j;
      }
      diag.exhausted = true;
      return 0;
    }

    diag.maxDepth = 0;
    diag.conflictJumps = 0;
    diag.deadEnds = 0;
    diag.skipBacks = 0;
    diag.exhausted = false;
    diag.hitLimit = false;

    try {
      const result = backtrack(0);
      if (result === true) return { board, relaxed, attempts, diag };
    } catch {
      // retry with different fill order
    }
  }

  return { diag };
}

/* ===================== greedy fallback ===================== */

function fillGreedy(
  pool: GoalItem[],
  grid: number[][],
): { board: GoalItem[]; relaxed: number[] } {
  for (const strictGlobal of [true, false]) {
    const board: (GoalItem | null)[] = Array(25).fill(null);
    const used = new Set<number>();
    const usedGlobal = new Set<string>();
    const usedVariants = new Set<string>();
    const relaxed: number[] = [];

    const flatPositions = shuffle(Array.from({ length: 25 }, (_, i) => i));

    for (const pos of flatPositions) {
      const target = grid[Math.floor(pos / 5)][pos % 5];

      const candidates = pool
        .map((g, i) => ({ g, i }))
        .filter(({ i, g }) => {
          if (used.has(i)) return false;
          const vg = getVariantGroupId(g);
          if (vg && usedVariants.has(vg)) return false;
          return getDifficulty(g) === target;
        })
        .filter(({ g }) =>
          canPlace(
            g,
            pos,
            board,
            strictGlobal ? usedGlobal : new Set(),
            usedVariants,
          ),
        );

      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        board[pos] = pick.g;
        used.add(pick.i);
        const vg = getVariantGroupId(pick.g);
        if (vg) usedVariants.add(vg);
        const gg = getGlobalExcl(pick.g);
        for (const ggg of gg) usedGlobal.add(ggg);
      } else {
        relaxed.push(pos);
        const fallback = pool
          .map((g, i) => ({ g, i }))
          .filter(({ i, g }) => {
            if (used.has(i)) return false;
            const vg = getVariantGroupId(g);
            if (vg && usedVariants.has(vg)) return false;
            return canPlace(
              g,
              pos,
              board,
              strictGlobal ? usedGlobal : new Set(),
              usedVariants,
            );
          });
        if (fallback.length > 0) {
          const pick = fallback[Math.floor(Math.random() * fallback.length)];
          board[pos] = pick.g;
          used.add(pick.i);
          const vg = getVariantGroupId(pick.g);
          if (vg) usedVariants.add(vg);
          const gg = getGlobalExcl(pick.g);
          for (const ggg of gg) usedGlobal.add(ggg);
        }
      }
    }

    for (let i = 0; i < 25; i++) {
      if (!board[i]) {
        relaxed.push(i);
        const fallback = pool.find((g, j) => {
          if (used.has(j)) return false;
          const vg = getVariantGroupId(g);
          if (vg && usedVariants.has(vg)) return false;
          return canPlace(
            g,
            i,
            board,
            strictGlobal ? usedGlobal : new Set(),
            usedVariants,
          );
        });
        if (fallback) {
          board[i] = fallback;
          used.add(pool.indexOf(fallback));
          const vg = getVariantGroupId(fallback);
          if (vg) usedVariants.add(vg);
          const gg = getGlobalExcl(fallback);
          for (const ggg of gg) usedGlobal.add(ggg);
        }
      }
    }

    const result = board.filter((g): g is GoalItem => g !== null);
    if (result.length === 25) return { board: result, relaxed };
  }

  const board: GoalItem[] = [];
  const used = new Set<number>();
  const usedVariants = new Set<string>();
  for (const g of shuffle(pool)) {
    const i = pool.indexOf(g);
    if (used.has(i)) continue;
    const vg = getVariantGroupId(g);
    if (vg && usedVariants.has(vg)) continue;
    used.add(i);
    if (vg) usedVariants.add(vg);
    board.push(g);
    if (board.length === 25) break;
  }
  return { board, relaxed: [] };
}

/* ===================== public API ===================== */

export function pattern(pool: GoalItem[], pattern: number[]): PatternResult {
  const expanded = expandVariants(pool);
  const { grid: resultGrid, attempts: gridAttempts } =
    buildSequenceGrid(pattern);
  let grid: number[][];
  let usedFormulaFallback = false;
  if (resultGrid) {
    grid = resultGrid;
  } else {
    grid = buildSequenceGridFormula(pattern);
    usedFormulaFallback = true;
  }

  const btResult = fillByBacktrack(expanded, grid);

  if ("board" in btResult) {
    return {
      board: btResult.board.filter((g): g is GoalItem => g !== null),
      gridAttempts,
      fillAttempts: btResult.attempts,
      usedFormulaFallback,
      usedGreedyFallback: false,
      relaxedPositions: [...btResult.relaxed].sort((a, b) => a - b),
      backtrackDiag: btResult.diag,
    };
  }

  const greedy = fillGreedy(expanded, grid);
  return {
    board: greedy.board,
    gridAttempts,
    fillAttempts: 0,
    usedFormulaFallback,
    usedGreedyFallback: true,
    relaxedPositions: greedy.relaxed,
    backtrackDiag: btResult.diag,
  };
}
