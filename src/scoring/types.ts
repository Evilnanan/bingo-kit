// ============================================================
// Scoring rule definitions
// ============================================================

export interface ScoringRule {
  id: string;
  name: string;
  items: ScoringItem[];
}

export interface ScoringItem {
  id: string;
  /** Which target domain this item applies to. */
  target: "cell" | "bingo";
  /** Optional expression that must evaluate to truthy for the item to apply. */
  condition?: string;
  /** Expression that evaluates to the number of points awarded. */
  points: string;
  /** Human-readable label for the editor UI. */
  label?: string;
}

// ============================================================
// Expression AST
// ============================================================

export type ASTNode =
  | { kind: "literal"; value: number | string }
  | { kind: "identifier"; name: string }
  | { kind: "member"; object: ASTNode; property: string }
  | { kind: "index"; object: ASTNode; index: ASTNode }
  | { kind: "method"; object: ASTNode; method: string; args: ASTNode[] }
  | { kind: "lambda"; param: string; body: ASTNode }
  | { kind: "unary"; op: string; expr: ASTNode }
  | { kind: "binary"; op: string; left: ASTNode; right: ASTNode }
  | { kind: "ternary"; cond: ASTNode; thenExpr: ASTNode; elseExpr: ASTNode }
  | { kind: "call"; name: string; args: ASTNode[] };

// ============================================================
// Shared reference objects (used in context tree)
// ============================================================

/** Static cell properties — shared across all players' contexts. */
export interface CellRef {
  row: number;
  col: number;
  diag: boolean;
  difficulty: number;
  counter: number;
}

/** Static player properties — shared across all contexts.
 *  Players are identified solely by color; same-color players are one team. */
export interface PlayerRef {
  color: string;
}

/** Static bingo line properties — shared across all contexts. */
export interface BingoRef {
  type: "row" | "col" | "diag";
  index: number;
}

// ============================================================
// Runtime context (reference objects + dynamic arrays)
// ============================================================

/** A cell ref with runtime arrays attached. */
export interface CellRefRuntime extends CellRef {
  players: PlayerRef[];
  bingos: BingoRef[];
}

/** A bingo ref with runtime arrays attached. */
export interface BingoRefRuntime extends BingoRef {
  cells: CellRef[];
  players: PlayerRef[];
}

/** A player ref with runtime arrays attached. */
export interface PlayerRefRuntime extends PlayerRef {
  bingos: BingoRef[];
}

/** Global scope with runtime arrays. */
export interface GlobalRuntime {
  players: PlayerRef[];
  bingos: BingoRef[];
}

/** The full scoring context passed to expression evaluation. */
export interface ScoringContext {
  cell: CellRefRuntime;
  bingo?: BingoRefRuntime;
  player: PlayerRefRuntime;
  global: GlobalRuntime;
}

// ============================================================
// Bingo detection
// ============================================================

/** A detected bingo line with ordering metadata. */
export interface DetectedBingo extends BingoRef {
  /** Indices of the 5 cells that form this line. */
  cellIndices: number[];
  /** The player (name) who completed this line. */
  playerName: string;
  /** The player's color — used to match marks. */
  playerColor: string;
  /** Timestamp of the last mark that completed the line. */
  completedAt: number;
}

export interface BingoDetectionResult {
  /** All bingo lines across all players, sorted by completedAt (earliest first). */
  allBingos: DetectedBingo[];
  /** playerName → array of their completed bingo lines (by completion order). */
  playerBingos: Map<string, DetectedBingo[]>;
}

// ============================================================
// Score output
// ============================================================

export type ScoreMap = Record<string, number>;
