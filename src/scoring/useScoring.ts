import type { MarkEntry, GoalItem, Player } from "../types";
import type { ScoringRule, ScoreMap } from "./types";
import { calculateScores, calculateCellScores } from "./scoreCalculator";

/**
 * React hook that reactively computes scores from game state.
 * Falls back to the default rule (1 point per cell) when no rule is provided.
 *
 * NOTE: React Compiler automatically memoizes the `calculateScores` call —
 * no manual `useMemo` needed.
 */
export function useScoring(
  marks: Record<number, MarkEntry[]>,
  players: Record<string, Player>,
  goals: GoalItem[],
  rule: ScoringRule | undefined | null,
  colorAliases?: Record<string, string>,
): {
  /** Total scores per player name (for PlayerList display). */
  scores: ScoreMap;
  /** Per-cell scores keyed by COLOR. cellIndex → markColor → points. */
  cellScores: Record<number, Record<string, number>>;
} {
  const effectiveRule = rule ?? undefined;
  const scores = calculateScores(
    marks,
    players,
    goals,
    effectiveRule,
    colorAliases,
  );
  const cellScores = calculateCellScores(
    marks,
    players,
    goals,
    effectiveRule,
    colorAliases,
  );
  return { scores, cellScores };
}
