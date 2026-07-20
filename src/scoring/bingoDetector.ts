/**
 * Bingo line detection for classic 5×5 boards.
 *
 * Detects completed lines from marks, determines completion order
 * via timestamps, and returns structured results for scoring.
 */

import type { MarkEntry } from "../types";
import { LINES } from "../randomPicks/utils";
import type { DetectedBingo, BingoDetectionResult } from "./types";

// Map LINES array index → BingoRef (type + index)
const LINE_META: { type: "row" | "col" | "diag"; index: number }[] = [
  // LINES[0..4] → rows
  { type: "row", index: 0 },
  { type: "row", index: 1 },
  { type: "row", index: 2 },
  { type: "row", index: 3 },
  { type: "row", index: 4 },
  // LINES[5..9] → columns
  { type: "col", index: 0 },
  { type: "col", index: 1 },
  { type: "col", index: 2 },
  { type: "col", index: 3 },
  { type: "col", index: 4 },
  // LINES[10..11] → diagonals
  { type: "diag", index: 0 },
  { type: "diag", index: 1 },
];

/**
 * Detect all bingo lines from the current marks and players.
 *
 * Players are de-duplicated by color — same-color players share marks
 * and are treated as one team for bingo detection.
 *
 * @param marks  Cell index → array of MarkEntry (by color, with timestamp).
 * @param players Player name → { name, color }.
 * @returns Structured bingo detection result with ordering.
 */
export function detectBingos(
  marks: Record<number, MarkEntry[]>,
  players: Record<string, { name: string; color: string }>,
): BingoDetectionResult {
  const allBingos: DetectedBingo[] = [];

  // De-duplicate by color — same-color players are one team
  const seenColors = new Set<string>();

  for (const player of Object.values(players)) {
    const color = player.color;
    if (seenColors.has(color)) continue;
    seenColors.add(color);

    for (let li = 0; li < LINES.length; li++) {
      const cells = LINES[li];

      // Check if this color has marked all 5 cells
      const playerMarks: (MarkEntry | undefined)[] = cells.map((idx) => {
        const cellMarks = marks[idx] || [];
        return cellMarks.find((m) => m.by === color);
      });

      if (playerMarks.some((m) => !m)) continue;

      const completedAt = Math.max(...playerMarks.map((m) => m!.timestamp));
      const meta = LINE_META[li];

      allBingos.push({
        type: meta.type,
        index: meta.index,
        cellIndices: [...cells],
        playerName: color, // color IS the identity
        playerColor: color,
        completedAt,
      });
    }
  }

  // Sort globally by completion time
  allBingos.sort((a, b) => a.completedAt - b.completedAt);

  // Group by color
  const playerBingos = new Map<string, DetectedBingo[]>();
  for (const b of allBingos) {
    const list = playerBingos.get(b.playerName);
    if (list) {
      list.push(b);
    } else {
      playerBingos.set(b.playerName, [b]);
    }
  }

  return { allBingos, playerBingos };
}
