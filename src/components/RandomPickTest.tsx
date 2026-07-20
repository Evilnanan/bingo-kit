import { useState } from "react";
import {
  pureRandom,
  balancedDifficulty,
  pattern,
  fixed,
  type PatternResult,
} from "../randomPicks";
import type { GoalItem } from "../types";
import { getGoalText, getGoalDifficulty } from "../types";
import "./RandomPickTest.css";

/* ── presets ──────────────────────────────────────────────────── */

const PRESET_SIMPLE: GoalItem[] = Array.from(
  { length: 40 },
  (_, i) => `Goal ${i + 1}`,
);

const PRESET_DIFFICULTY: GoalItem[] = [
  { text: "Easy A", difficulty: 1 },
  { text: "Easy B", difficulty: 1 },
  { text: "Easy C", difficulty: 1 },
  { text: "Easy D", difficulty: 1 },
  { text: "Easy E", difficulty: 1 },
  { text: "Easy F", difficulty: 1 },
  { text: "Easy G", difficulty: 1 },
  { text: "Easy H", difficulty: 1 },
  { text: "Medium A", difficulty: 2 },
  { text: "Medium B", difficulty: 2 },
  { text: "Medium C", difficulty: 2 },
  { text: "Medium D", difficulty: 2 },
  { text: "Medium E", difficulty: 2 },
  { text: "Medium F", difficulty: 2 },
  { text: "Medium G", difficulty: 2 },
  { text: "Medium H", difficulty: 2 },
  { text: "Hard A", difficulty: 3 },
  { text: "Hard B", difficulty: 3 },
  { text: "Hard C", difficulty: 3 },
  { text: "Hard D", difficulty: 3 },
  { text: "Hard E", difficulty: 3 },
  { text: "Hard F", difficulty: 3 },
  { text: "Hard G", difficulty: 3 },
  { text: "Hard H", difficulty: 3 },
  { text: "Expert A", difficulty: 4 },
  { text: "Expert B", difficulty: 4 },
  { text: "Expert C", difficulty: 4 },
  { text: "Expert D", difficulty: 4 },
  { text: "Expert E", difficulty: 4 },
  { text: "Expert F", difficulty: 4 },
  { text: "Expert G", difficulty: 4 },
  { text: "Expert H", difficulty: 4 },
  { text: "Insane A", difficulty: 5 },
  { text: "Insane B", difficulty: 5 },
  { text: "Insane C", difficulty: 5 },
  { text: "Insane D", difficulty: 5 },
  { text: "Insane E", difficulty: 5 },
  { text: "Insane F", difficulty: 5 },
  { text: "Insane G", difficulty: 5 },
  { text: "Insane H", difficulty: 5 },
];

const PRESET_EXCLUSIVE: GoalItem[] = [
  { text: "Red Gem A", group: "red_gems", difficulty: 2 },
  { text: "Red Gem B", group: "red_gems", difficulty: 3 },
  { text: "Red Gem C", group: "red_gems", difficulty: 4 },
  { text: "Blue Gem A", group: "blue_gems", difficulty: 2 },
  { text: "Blue Gem B", group: "blue_gems", difficulty: 3 },
  { text: "Blue Gem C", group: "blue_gems", difficulty: 4 },
  { text: "Green Gem A", group: "green_gems", difficulty: 2 },
  { text: "Green Gem B", group: "green_gems", difficulty: 3 },
  { text: "Green Gem C", group: "green_gems", difficulty: 4 },
  ...Array.from({ length: 22 }, (_, i) => `Plain ${i + 1}`),
];

const PRESETS: Record<string, GoalItem[]> = {
  simple: PRESET_SIMPLE,
  difficulty: PRESET_DIFFICULTY,
  exclusive: PRESET_EXCLUSIVE,
};

/* ── helpers ──────────────────────────────────────────────────── */

const DIFF_COLORS = ["#4caf50", "#8bc34a", "#ffc107", "#ff9800", "#f44336"];

function difficultyColor(d: number): string {
  return DIFF_COLORS[Math.max(0, Math.min(4, d - 1))] ?? "#888";
}

const ROWS = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
];
const COLS = [
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
];
const DIAGS = [
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

function lineSum(board: GoalItem[], line: number[]) {
  return line.reduce(
    (s, i) => s + (board[i] ? (getGoalDifficulty(board[i]) ?? 1) : 1),
    0,
  );
}

type BoardResult = { board: GoalItem[]; error?: string };

function ResultGrid({
  result,
  relaxedPositions,
}: {
  result: BoardResult | null;
  relaxedPositions?: Set<number>;
}) {
  if (!result) return <div className="rptest-info">Not run yet</div>;
  if (result.error) return <div className="rptest-error">{result.error}</div>;

  const { board } = result;
  const ALL_LINES = [...ROWS, ...COLS, ...DIAGS];
  const lineSums = ALL_LINES.map((l) => lineSum(board, l));
  const max = Math.max(...lineSums);
  const min = Math.min(...lineSums);
  const mean = lineSums.reduce((s, v) => s + v, 0) / lineSums.length;
  const std = Math.sqrt(
    lineSums.reduce((s, v) => s + (v - mean) ** 2, 0) / lineSums.length,
  );

  return (
    <div className="rptest-grid-wrap">
      <div className="rptest-grid-with-rows">
        <div className="rptest-grid">
          {board.map((g, i) => {
            const d = getGoalDifficulty(g) ?? 1;
            const relaxed = relaxedPositions?.has(i);
            return (
              <div
                key={i}
                className={`rptest-cell${relaxed ? " relaxed" : ""}`}
                style={{
                  backgroundColor: difficultyColor(d) + "22",
                  borderColor: difficultyColor(d),
                }}
              >
                <span>{getGoalText(g)}</span>
                <span
                  className="diff-dot"
                  style={{ backgroundColor: difficultyColor(d) }}
                />
              </div>
            );
          })}
        </div>
        <div className="rptest-row-sums">
          {ROWS.map((row, ri) => (
            <span key={ri}>{lineSum(board, row)}</span>
          ))}
        </div>
      </div>
      <div className="rptest-col-sums">
        {COLS.map((col, ci) => (
          <span key={ci}>{lineSum(board, col)}</span>
        ))}
      </div>
      <div className="rptest-diag-sums">
        <span>↘ {lineSum(board, DIAGS[0])}</span>
        <span>↙ {lineSum(board, DIAGS[1])}</span>
      </div>
      <div className="rptest-stats">
        max {max} min {min} μ {mean.toFixed(1)} σ {std.toFixed(1)}
      </div>
    </div>
  );
}

/* ── component ────────────────────────────────────────────────── */

export default function RandomPickTest() {
  const [poolText, setPoolText] = useState(() =>
    JSON.stringify(PRESET_DIFFICULTY, null, 2),
  );
  const [balMin, setBalMin] = useState(1);
  const [balMax, setBalMax] = useState(5);
  const [balCenter, setBalCenter] = useState(true);
  const [patPattern, setPatPattern] = useState("1,1,2,3,4");

  const [pureResult, setPureResult] = useState<BoardResult | null>(null);
  const [balResult, setBalResult] = useState<BoardResult | null>(null);
  const [patResult, setPatResult] = useState<PatternResult | null>(null);
  const [patError, setPatError] = useState<string | null>(null);
  const [fixedResult, setFixedResult] = useState<BoardResult | null>(null);

  const pool = (() => {
    try {
      return JSON.parse(poolText) as GoalItem[];
    } catch {
      return null;
    }
  })();

  const loadPreset = (key: string) => {
    setPoolText(JSON.stringify(PRESETS[key], null, 2));
  };

  const runPure = () => {
    if (!pool) return;
    try {
      setPureResult({ board: pureRandom(pool) });
    } catch (e: unknown) {
      setPureResult({
        board: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const runBalanced = () => {
    if (!pool) return;
    try {
      setBalResult({
        board: balancedDifficulty(pool, {
          minDifficulty: balMin,
          maxDifficulty: balMax,
          centerHardest: balCenter,
        }),
      });
    } catch (e: unknown) {
      setBalResult({
        board: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const runPattern = () => {
    if (!pool) return;
    try {
      const pat = patPattern.split(",").map((s) => {
        const n = parseInt(s.trim(), 10);
        return isNaN(n) ? 1 : Math.max(1, Math.min(5, n));
      });
      while (pat.length < 5) pat.push(1);
      setPatResult(pattern(pool, pat.slice(0, 5)));
      setPatError(null);
    } catch (e: unknown) {
      setPatResult(null);
      setPatError(e instanceof Error ? e.message : String(e));
    }
  };

  const runFixed = () => {
    if (!pool) return;
    try {
      setFixedResult({ board: fixed(pool) });
    } catch (e: unknown) {
      setFixedResult({
        board: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const runAll = () => {
    runPure();
    runBalanced();
    runPattern();
    runFixed();
  };

  return (
    <div className="rptest">
      <h2>RandomPick Test</h2>

      <div className="rptest-bar">
        <button onClick={runAll} disabled={!pool}>
          Run All
        </button>
        <button onClick={runPure} disabled={!pool}>
          Run Pure
        </button>
        <button onClick={runBalanced} disabled={!pool}>
          Run Balanced
        </button>
        <button onClick={runPattern} disabled={!pool}>
          Run Pattern
        </button>
        <button onClick={runFixed} disabled={!pool}>
          Run Fixed
        </button>
        {!pool && <span className="rptest-error">Invalid JSON pool</span>}
      </div>

      <div className="rptest-pool">
        <textarea
          value={poolText}
          onChange={(e) => setPoolText(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="rptest-presets">
        <span>Presets:</span>
        {Object.keys(PRESETS).map((key) => (
          <button key={key} onClick={() => loadPreset(key)}>
            {key}
          </button>
        ))}
      </div>

      <div className="rptest-algos">
        {/* Pure Random */}
        <div className="rptest-algo">
          <h3>Pure Random</h3>
          <ResultGrid result={pureResult} />
        </div>

        {/* Balanced Difficulty */}
        <div className="rptest-algo">
          <h3>Balanced Difficulty</h3>
          <div className="rptest-algo-controls">
            <label>
              Min{" "}
              <input
                type="number"
                min={1}
                max={5}
                value={balMin}
                onChange={(e) => setBalMin(parseInt(e.target.value) || 1)}
              />
            </label>
            <label>
              Max{" "}
              <input
                type="number"
                min={1}
                max={5}
                value={balMax}
                onChange={(e) => setBalMax(parseInt(e.target.value) || 5)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={balCenter}
                onChange={(e) => setBalCenter(e.target.checked)}
              />{" "}
              Center hardest
            </label>
          </div>
          <ResultGrid result={balResult} />
        </div>

        {/* Pattern */}
        <div className="rptest-algo">
          <h3>Pattern</h3>
          <div className="rptest-algo-controls">
            <label>
              Pattern{" "}
              <input
                type="text"
                value={patPattern}
                onChange={(e) => setPatPattern(e.target.value)}
                placeholder="1,1,2,3,4"
              />
            </label>
          </div>
          {patError && <div className="rptest-error">{patError}</div>}
          {patResult && (
            <>
              <ResultGrid
                result={{ board: patResult.board }}
                relaxedPositions={new Set(patResult.relaxedPositions)}
              />
              <div className="rptest-seq-meta">
                <div>
                  Grid attempts: {patResult.gridAttempts.toLocaleString()}
                  {patResult.usedFormulaFallback ? " → formula" : ""}
                </div>
                <div>
                  Fill attempts:{" "}
                  {patResult.fillAttempts > 0
                    ? patResult.fillAttempts.toLocaleString()
                    : "—"}
                  {patResult.usedGreedyFallback ? " → greedy" : ""}
                </div>
                <div>
                  Relaxed cells ({patResult.relaxedPositions.length}/25):{" "}
                  {patResult.relaxedPositions.length > 0
                    ? patResult.relaxedPositions
                        .map((p) => `(${Math.floor(p / 5)},${p % 5})`)
                        .join(", ")
                    : "none"}
                </div>
                {patResult.backtrackDiag && (
                  <div
                    style={{
                      marginTop: 4,
                      color: patResult.usedGreedyFallback
                        ? "#e67e22"
                        : "#27ae60",
                    }}
                  >
                    depth max={patResult.backtrackDiag.maxDepth} deadEnds=
                    {patResult.backtrackDiag.deadEnds} confJumps=
                    {patResult.backtrackDiag.conflictJumps} skipBacks=
                    {patResult.backtrackDiag.skipBacks} exhausted=
                    {patResult.backtrackDiag.exhausted ? "Y" : "N"} hitLimit=
                    {patResult.backtrackDiag.hitLimit ? "Y" : "N"} retries=
                    {patResult.backtrackDiag.retries}
                  </div>
                )}
              </div>
            </>
          )}
          {!patError && !patResult && (
            <div className="rptest-info">Not run yet</div>
          )}
        </div>

        {/* Fixed Order */}
        <div className="rptest-algo">
          <h3>Fixed Order</h3>
          <ResultGrid result={fixedResult} />
        </div>
      </div>
    </div>
  );
}
