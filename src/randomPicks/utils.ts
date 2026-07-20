import type { GoalItem } from "../types";

/* ── shuffle ──────────────────────────────────────────────────────── */

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── goal property helpers ────────────────────────────────────────── */

export function getDifficulty(g: GoalItem): number {
  return typeof g === "string" ? 1 : (g.difficulty ?? 1);
}

export function getExcl(g: GoalItem): string[] {
  if (typeof g === "string") return [];
  const eg = g.group;
  if (!eg) return [];
  return Array.isArray(eg) ? eg : [eg];
}

export function getGlobalExcl(g: GoalItem): string[] {
  if (typeof g === "string") return [];
  const gg = g.globalGroup;
  if (!gg) return [];
  return Array.isArray(gg) ? gg : [gg];
}

/* ── board lines ──────────────────────────────────────────────────── */

/** All 12 lines on a 5×5 bingo board: 5 rows + 5 cols + 2 diagonals. */
export const LINES: number[][] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

/** Return the lines that contain the given position. */
export function linesFor(pos: number): number[][] {
  return LINES.filter((l) => l.includes(pos));
}

/** Precompute which lines each position belongs to (index → line indices). */
export const POSITION_LINES: number[][] = Array.from({ length: 25 }, () => []);
for (let li = 0; li < LINES.length; li++) {
  for (const pos of LINES[li]) {
    POSITION_LINES[pos].push(li);
  }
}

/** Sum difficulties of placed goals on a line. */
export function lineSum(board: (GoalItem | null)[], line: number[]): number {
  let sum = 0;
  for (const idx of line) {
    const g = board[idx];
    if (g) sum += getDifficulty(g);
  }
  return sum;
}

/* ── constraint check ─────────────────────────────────────────────── */

/** Check whether placing `g` at `pos` on `board` would violate any exclusive-group constraint. */
export function canPlace(
  g: GoalItem,
  pos: number,
  board: (GoalItem | null)[],
  usedGlobalGroups: Set<string>,
): boolean {
  for (const gg of getGlobalExcl(g)) {
    if (usedGlobalGroups.has(gg)) return false;
  }
  const groups = getExcl(g);
  if (groups.length === 0) return true;
  for (const line of linesFor(pos)) {
    for (const idx of line) {
      const other = board[idx];
      if (!other) continue;
      const otherGroups = getExcl(other);
      if (groups.some((eg) => otherGroups.includes(eg))) return false;
    }
  }
  return true;
}
