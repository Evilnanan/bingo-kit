/** Balanced difficulty configuration. */
export interface BalancedConfig {
  minDifficulty: number;
  maxDifficulty: number;
  centerHardest: boolean;
}

export type PickAlgorithm = "pure" | "balanced" | "pattern" | "fixed";

export type PickRule =
  | { algorithm: "pure" | "fixed" }
  | {
      algorithm: "balanced";
      minDifficulty: number;
      maxDifficulty: number;
      centerHardest: boolean;
    }
  | { algorithm: "pattern"; pattern: string };

/** Result returned by the pattern algorithm. */
export interface PatternResult {
  board: import("../types").GoalItem[];
  gridAttempts: number;
  fillAttempts: number;
  usedFormulaFallback: boolean;
  usedGreedyFallback: boolean;
  relaxedPositions: number[];
  backtrackDiag?: {
    maxDepth: number;
    conflictJumps: number;
    deadEnds: number;
    skipBacks: number;
    exhausted: boolean;
    hitLimit: boolean;
    retries: number;
  };
}
