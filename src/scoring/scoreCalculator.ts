/**
 * Score calculator — the core engine that ties bingo detection,
 * context construction, and expression evaluation together.
 *
 * Process-independent: given the same marks + rule, the score is
 * deterministic (ordering derived from timestamps in MarkEntry).
 */

import { getGoalDifficulty, getGoalCounter } from "../types";
import type { MarkEntry, GoalItem, Player } from "../types";
import { parseAndEvaluate } from "./expressionParser";
import { detectBingos } from "./bingoDetector";
import { DEFAULT_SCORING_RULE } from "./defaultRule";
import type {
  ScoringRule,
  ScoreMap,
  CellRefRuntime,
  PlayerRefRuntime,
  BingoRefRuntime,
  GlobalRuntime,
  ScoringContext,
  DetectedBingo,
} from "./types";

// ============================================================
// Context construction helpers
// ============================================================

/** Build a CellRefRuntime for every board position (static properties only). */
function buildCellRefs(goals: GoalItem[]): CellRefRuntime[] {
  return goals.map((g, i) => {
    const diag =
      [0, 6, 12, 18, 24].includes(i) || [4, 8, 12, 16, 20].includes(i);
    return {
      row: Math.floor(i / 5),
      col: i % 5,
      diag,
      difficulty: getGoalDifficulty(g) ?? 1,
      counter: getGoalCounter(g),
      players: [],
      bingos: [],
    };
  });
}

/**
 * Fill `.players` for each cell — which players (by color) have marked
 * this cell, sorted by their first-mark timestamp.
 */
function fillCellPlayers(
  cells: CellRefRuntime[],
  marks: Record<number, MarkEntry[]>,
  playerRefs: Map<string, PlayerRefRuntime>,
): void {
  // color → PlayerRefRuntime
  const colorToPlayer = new Map<string, PlayerRefRuntime>();
  for (const pr of playerRefs.values()) {
    if (!colorToPlayer.has(pr.color)) {
      colorToPlayer.set(pr.color, pr);
    }
  }

  for (let i = 0; i < cells.length; i++) {
    const cellMarks = marks[i] || [];
    const sorted = [...cellMarks].sort((a, b) => a.timestamp - b.timestamp);
    const playerList: PlayerRefRuntime[] = [];
    for (const entry of sorted) {
      const pr = colorToPlayer.get(entry.by);
      if (pr) playerList.push(pr);
    }
    cells[i] = { ...cells[i], players: playerList };
  }
}

/** Build BingoRefRuntime objects — one per unique bingo line, with all players attached. */
function buildBingoRefs(
  allBingos: DetectedBingo[],
  cellRefs: CellRefRuntime[],
  playerRefs: Map<string, PlayerRefRuntime>,
): BingoRefRuntime[] {
  // Group by line identity to determine per-line player ordering
  const lineGroups = new Map<string, DetectedBingo[]>();
  for (const b of allBingos) {
    const key = `${b.type}-${b.index}`;
    const group = lineGroups.get(key);
    if (group) group.push(b);
    else lineGroups.set(key, [b]);
  }
  for (const group of lineGroups.values()) {
    group.sort((a, b) => a.completedAt - b.completedAt);
  }

  // Return one BingoRefRuntime per unique line (not per DetectedBingo)
  const result: BingoRefRuntime[] = [];
  for (const [, group] of lineGroups) {
    const first = group[0];
    const cellRefsForLine = first.cellIndices.map((idx) => cellRefs[idx]);
    const linePlayers = group.map((gb) => playerRefs.get(gb.playerName)!);

    result.push({
      type: first.type,
      index: first.index,
      cells: cellRefsForLine,
      players: linePlayers,
    });
  }
  return result;
}

/**
 * Build the full ScoringContext for a single color.
 * Shared references are preserved so that .indexOf() works
 * (same PlayerRef instance in cell.players and bingo.players).
 */
function buildPlayerContext(
  color: string,
  baseCellRefs: CellRefRuntime[],
  playerRefs: Map<string, PlayerRefRuntime>,
  allBingoRefs: BingoRefRuntime[],
): {
  ctx: ScoringContext;
  playerCells: CellRefRuntime[];
  playerBingos: BingoRefRuntime[];
} {
  const player = playerRefs.get(color)!;

  // Collect which bingos this player completed
  const playerBingos: BingoRefRuntime[] = [];
  for (const br of allBingoRefs) {
    if (br.players.some((p) => p === player)) {
      playerBingos.push(br);
    }
  }

  // Per-player cell refs (shallow copy with player-specific bingos)
  const perPlayerCells: CellRefRuntime[] = baseCellRefs.map((c) => {
    const cellBingos: BingoRefRuntime[] = [];
    for (const br of playerBingos) {
      if (br.cells.some((bc) => bc.row === c.row && bc.col === c.col)) {
        cellBingos.push(br);
      }
    }
    return { ...c, bingos: cellBingos };
  });

  // Cells marked by this player
  const playerCells = perPlayerCells.filter((c) =>
    c.players.some((p) => p === player),
  );

  // Use the SAME PlayerRefRuntime instance that's in cell.players and bingo.players,
  // so that .indexOf(player) works via reference equality.
  const playerRuntime: PlayerRefRuntime = player;
  playerRuntime.bingos = playerBingos;

  // Global runtime
  const globalRuntime: GlobalRuntime = {
    players: [...playerRefs.values()],
    bingos: allBingoRefs,
  };

  const ctx: ScoringContext = {
    cell: perPlayerCells[0], // placeholder — overridden per item
    player: playerRuntime,
    global: globalRuntime,
  };

  return { ctx, playerCells, playerBingos };
}

// ============================================================
// Helpers — build player refs from players (deduped by color)
// ============================================================

/**
 * Build a color → PlayerRefRuntime map from the players record.
 * Same-color players share one ref (they're a team).
 * Also includes orphaned colors found in marks.
 */
function buildPlayerRefs(
  marks: Record<number, MarkEntry[]>,
  players: Record<string, Player>,
): Map<string, PlayerRefRuntime> {
  const refs = new Map<string, PlayerRefRuntime>();

  // Real players — deduped by color
  for (const p of Object.values(players)) {
    if (!refs.has(p.color)) {
      refs.set(p.color, { color: p.color, bingos: [] });
    }
  }

  // Orphaned colors from marks (player changed color)
  for (const cellMarks of Object.values(marks)) {
    for (const entry of cellMarks) {
      if (!refs.has(entry.by)) {
        refs.set(entry.by, { color: entry.by, bingos: [] });
      }
    }
  }

  return refs;
}

// ============================================================
// Public API
// ============================================================

/**
 * Calculate per-cell per-color scores.
 *
 * Returns a map of cellIndex → markColor → points earned from that cell.
 *
 * Keyed by COLOR (not player name) because marks on the board are stored
 * by color. When a player changes color, their old marks remain under the
 * old color — tracking by color keeps those marks correctly scored.
 * Multiple players sharing a color are treated as a team.
 */
export function calculateCellScores(
  marks: Record<number, MarkEntry[]>,
  players: Record<string, Player>,
  goals: GoalItem[],
  rule: ScoringRule | undefined,
  colorAliases?: Record<string, string>,
): Record<number, Record<string, number>> {
  const effectiveRule = rule ?? DEFAULT_SCORING_RULE;
  const result: Record<number, Record<string, number>> = {};

  const hasMarks = Object.values(marks).some((arr) => arr.length > 0);
  if (!hasMarks) return result;

  const playerRefs = buildPlayerRefs(marks, players);
  const bingoResult = detectBingos(marks, players);
  const baseCellRefs = buildCellRefs(goals);
  fillCellPlayers(baseCellRefs, marks, playerRefs);
  const allBingoRefs = buildBingoRefs(
    bingoResult.allBingos,
    baseCellRefs,
    playerRefs,
  );

  // Score each color
  for (const color of playerRefs.keys()) {
    const { ctx, playerCells } = buildPlayerContext(
      color,
      baseCellRefs,
      playerRefs,
      allBingoRefs,
    );

    for (const cell of playerCells) {
      const cellIndex = cell.row * 5 + cell.col;
      if (!result[cellIndex]) result[cellIndex] = {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evalCtx: Record<string, any> = {
        cell,
        player: ctx.player,
        global: ctx.global,
      };

      let cellScore = 0;
      for (const item of effectiveRule.items) {
        if (item.target !== "cell") continue;

        if (item.condition) {
          try {
            if (!parseAndEvaluate(item.condition, evalCtx)) continue;
          } catch {
            continue;
          }
        }

        try {
          cellScore += parseAndEvaluate(item.points, evalCtx);
        } catch {
          // skip
        }
      }

      result[cellIndex][color] = (result[cellIndex][color] ?? 0) + cellScore;
    }
  }

  // Merge alias colors into canonical colors (e.g. Hex mode: "red" → "#dc2626").
  if (colorAliases) {
    for (const [alias, canonical] of Object.entries(colorAliases)) {
      for (const cellIndex of Object.keys(result)) {
        const idx = Number(cellIndex);
        const aliasScore = result[idx]?.[alias];
        if (aliasScore != null) {
          if (!result[idx]) result[idx] = {};
          result[idx][canonical] = (result[idx][canonical] ?? 0) + aliasScore;
          delete result[idx][alias];
        }
      }
    }
  }

  return result;
}

/**
 * Calculate scores keyed by color.
 *
 * Same-color players share a score (they're a team). The ScoreMap keys
 * are color hex strings (e.g. "#2563eb"), matching MarkEntry.by.
 *
 * @returns ScoreMap mapping color → total score.
 */
export function calculateScores(
  marks: Record<number, MarkEntry[]>,
  players: Record<string, Player>,
  goals: GoalItem[],
  rule: ScoringRule | undefined,
  colorAliases?: Record<string, string>,
): ScoreMap {
  const effectiveRule = rule ?? DEFAULT_SCORING_RULE;
  const scores: ScoreMap = {};

  // No marks yet → all scores stay 0
  const hasMarks = Object.values(marks).some((arr) => arr.length > 0);
  if (!hasMarks) return scores;

  // 1. Detect bingo lines
  const bingoResult = detectBingos(marks, players);

  // 2. Build shared refs
  const baseCellRefs = buildCellRefs(goals);
  const playerRefs = buildPlayerRefs(marks, players);

  fillCellPlayers(baseCellRefs, marks, playerRefs);
  const allBingoRefs = buildBingoRefs(
    bingoResult.allBingos,
    baseCellRefs,
    playerRefs,
  );

  // 3. Score each color
  for (const color of playerRefs.keys()) {
    const { ctx, playerCells, playerBingos } = buildPlayerContext(
      color,
      baseCellRefs,
      playerRefs,
      allBingoRefs,
    );

    let total = 0;

    for (const item of effectiveRule.items) {
      if (item.target === "cell") {
        total += scoreCells(ctx, playerCells, item);
      } else {
        total += scoreBingoLines(ctx, playerBingos, item);
      }
    }

    scores[color] = total;
  }

  // Merge alias colors into canonical colors (e.g. Hex mode: "red" → "#dc2626").
  if (colorAliases) {
    for (const [alias, canonical] of Object.entries(colorAliases)) {
      const aliasScore = scores[alias];
      if (aliasScore != null) {
        scores[canonical] = (scores[canonical] ?? 0) + aliasScore;
        delete scores[alias];
      }
    }
  }

  return scores;
}

// ============================================================
// Item-level scoring
// ============================================================

function scoreCells(
  baseCtx: ScoringContext,
  cells: CellRefRuntime[],
  item: { condition?: string; points: string },
): number {
  let total = 0;

  for (const cell of cells) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: Record<string, any> = {
      cell,
      player: baseCtx.player,
      global: baseCtx.global,
    };

    if (item.condition) {
      try {
        if (!parseAndEvaluate(item.condition, ctx)) continue;
      } catch {
        continue;
      }
    }

    try {
      total += parseAndEvaluate(item.points, ctx);
    } catch {
      // skip
    }
  }

  return total;
}

function scoreBingoLines(
  baseCtx: ScoringContext,
  bingos: BingoRefRuntime[],
  item: { condition?: string; points: string },
): number {
  let total = 0;

  for (const bingo of bingos) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: Record<string, any> = {
      bingo,
      cell: bingo.cells[0] ?? null,
      player: baseCtx.player,
      global: baseCtx.global,
    };

    if (item.condition) {
      try {
        if (!parseAndEvaluate(item.condition, ctx)) continue;
      } catch {
        continue;
      }
    }

    try {
      total += parseAndEvaluate(item.points, ctx);
    } catch {
      // skip
    }
  }

  return total;
}
