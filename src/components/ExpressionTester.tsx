import { useState } from "react";
import { parse, evaluate } from "../scoring/expressionParser";
import type {
  ScoringContext,
  CellRefRuntime,
  BingoRef,
  BingoRefRuntime,
  PlayerRef,
  PlayerRefRuntime,
  GlobalRuntime,
} from "../scoring/types";
import "./ExpressionTester.css";

/* ── helpers ───────────────────────────────────────────────────────── */

function formatResult(val: unknown): string {
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "boolean") return String(val);
  if (val === null || val === undefined) return String(val);
  if (Array.isArray(val)) {
    // Display array summary without circular refs
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return `[${val.length} items]`;
    }
  }
  if (typeof val === "object") {
    // Objects may have circular refs (e.g. global, player, bingo)
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      // Fallback: pick a few meaningful keys
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj);
      const summary: Record<string, unknown> = {};
      for (const k of keys.slice(0, 6)) {
        const v = obj[k];
        if (Array.isArray(v)) {
          summary[k] = `[${v.length} items]`;
        } else if (typeof v === "object" && v !== null) {
          summary[k] = `{${Object.keys(v as object).join(", ")}}`;
        } else {
          summary[k] = v;
        }
      }
      if (keys.length > 6) summary["…"] = `+${keys.length - 6} more keys`;
      return JSON.stringify(summary, null, 2);
    }
  }
  return String(val);
}

function parseExpr(expr: string) {
  try {
    return { ok: true as const, ast: parse(expr) };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function evalExpr(
  astResult: ReturnType<typeof parseExpr>,
  ctx: ScoringContext | null,
) {
  if (!ctx || !astResult.ok) return null;
  try {
    return { ok: true as const, value: evaluate(astResult.ast, ctx) };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Compute which cells belong to a bingo line
function bingoCells(
  type: string,
  index: number,
): { row: number; col: number }[] {
  if (type === "row") {
    return Array.from({ length: 5 }, (_, c) => ({ row: index, col: c }));
  }
  if (type === "col") {
    return Array.from({ length: 5 }, (_, r) => ({ row: r, col: index }));
  }
  if (type === "diag") {
    return index === 0
      ? Array.from({ length: 5 }, (_, i) => ({ row: i, col: i }))
      : Array.from({ length: 5 }, (_, i) => ({ row: i, col: 4 - i }));
  }
  return [];
}

/* ── default data ───────────────────────────────────────────────────── */

// Per-cell base data for all 25 cells
interface CellData {
  difficulty: number;
  counter: number;
}

function defaultCells(): CellData[] {
  // Classic center-hardest pattern
  const diffs = [
    1, 1, 2, 1, 1, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1, 1, 1, 2, 1, 1,
  ];
  return diffs.map((d) => ({ difficulty: d, counter: 0 }));
}

const DEFAULT_PLAYERS: PlayerRef[] = [
  { color: "#e74c3c" },
  { color: "#3498db" },
  { color: "#2ecc71" },
];

const DEFAULT_BINGOS: BingoRef[] = [
  { type: "row", index: 2 },
  { type: "diag", index: 0 },
  { type: "col", index: 1 },
];

const DEFAULT_MARKS: Record<string, number[]> = {
  // playerIndex → cellIndices they've marked
  "0": [0, 4, 7, 10, 12, 15, 20],
  "1": [3, 8, 12, 13, 17, 21],
  "2": [10, 11, 12, 14],
};

const DEFAULT_BINGO_PLAYERS: Record<string, number[]> = {
  // bingoKey → playerIndices
  "row:2": [0],
  "diag:0": [0, 1],
  "col:1": [2],
};

function bingoKey(b: BingoRef): string {
  return `${b.type}:${b.index}`;
}

/* ── build ScoringContext from editor state ─────────────────────────── */

function buildContext(
  cells: CellData[],
  players: PlayerRef[],
  bingos: BingoRef[],
  marks: Record<string, number[]>,
  bingoPlayers: Record<string, number[]>,
  curCellIdx: number,
  curPlayerIdx: number,
  curBingoIdx: number,
): ScoringContext {
  // Build canonical PlayerRefRuntime objects — shared across cell/bingo/player
  // so that .indexOf() works via reference equality.
  const playerRefs: PlayerRefRuntime[] = players.map((p) => ({
    ...p,
    bingos: [] as BingoRef[],
  }));

  // Build canonical BingoRefRuntime objects — shared across global.bingos,
  // ctx.bingo, cell.bingos, and player.bingos for reference equality.
  const bingoRefs: BingoRefRuntime[] = bingos.map((b) => {
    const bc = bingoCells(b.type, b.index);
    const bKey = bingoKey(b);
    const bpIndices = bingoPlayers[bKey] ?? [];
    return {
      type: b.type,
      index: b.index,
      cells: bc.map(({ row, col }) => {
        const idx = row * 5 + col;
        const cd = cells[idx];
        return {
          row,
          col,
          diag: row === col || row + col === 4,
          difficulty: cd.difficulty,
          counter: cd.counter,
        };
      }),
      players: bpIndices.map((i) => playerRefs[i]),
    };
  });

  // Fill player bingos (using same bingoRefs instances)
  for (const [bKey, pIndices] of Object.entries(bingoPlayers)) {
    const [type, idxStr] = bKey.split(":");
    const bIdx = bingos.findIndex(
      (b) => b.type === type && b.index === parseInt(idxStr, 10),
    );
    if (bIdx >= 0) {
      for (const pi of pIndices) {
        playerRefs[pi].bingos.push(bingoRefs[bIdx]);
      }
    }
  }

  const curRow = Math.floor(curCellIdx / 5);
  const curCol = curCellIdx % 5;
  const curCellData = cells[curCellIdx];
  const curPlayer = playerRefs[curPlayerIdx];

  // Which players marked the current cell
  const cellPlayers: PlayerRefRuntime[] = [];
  for (const [pIdxStr, indices] of Object.entries(marks)) {
    if (indices.includes(curCellIdx)) {
      cellPlayers.push(playerRefs[parseInt(pIdxStr, 10)]);
    }
  }

  // Which bingos pass through the current cell (use same bingoRefs instances)
  const cellBingos: BingoRefRuntime[] = [];
  for (const br of bingoRefs) {
    if (br.cells.some((c) => c.row === curRow && c.col === curCol)) {
      cellBingos.push(br);
    }
  }

  const cell: CellRefRuntime = {
    row: curRow,
    col: curCol,
    diag: curRow === curCol || curRow + curCol === 4,
    difficulty: curCellData.difficulty,
    counter: curCellData.counter,
    players: cellPlayers,
    bingos: cellBingos,
  };

  // Current bingo — use the canonical BingoRefRuntime
  const bingo: BingoRefRuntime | undefined =
    curBingoIdx >= 0 ? bingoRefs[curBingoIdx] : undefined;

  const global: GlobalRuntime = {
    players: playerRefs,
    bingos: bingoRefs,
  };

  return { cell, bingo, player: curPlayer, global };
}

/* ── BoardGrid ──────────────────────────────────────────────────────── */

function BoardGrid({
  cells,
  marks,
  players,
  curCellIdx,
  curBingo,
  onSelectCell,
}: {
  cells: CellData[];
  marks: Record<string, number[]>;
  players: PlayerRef[];
  curCellIdx: number;
  curBingo: BingoRef | null;
  onSelectCell: (idx: number) => void;
}) {
  const bingoCellSet = new Set<string>();
  if (curBingo) {
    for (const { row, col } of bingoCells(curBingo.type, curBingo.index)) {
      bingoCellSet.add(`${row},${col}`);
    }
  }

  // Build a map: cellIndex → player colors who marked it
  const cellColors: Record<number, string[]> = {};
  for (const [pIdxStr, indices] of Object.entries(marks)) {
    const color = players[parseInt(pIdxStr, 10)]?.color;
    if (!color) continue;
    for (const ci of indices) {
      (cellColors[ci] ??= []).push(color);
    }
  }

  return (
    <div className="et-grid">
      {cells.map((cd, i) => {
        const row = Math.floor(i / 5);
        const col = i % 5;
        const isCur = i === curCellIdx;
        const inBingo = bingoCellSet.has(`${row},${col}`);
        const marks2 = cellColors[i] ?? [];

        return (
          <button
            key={i}
            type="button"
            className={`et-cell${isCur ? " et-cell--cur" : ""}${inBingo ? " et-cell--bingo" : ""}`}
            style={
              marks2.length > 0
                ? {
                    background:
                      marks2.length === 1
                        ? marks2[0] + "33"
                        : `conic-gradient(${marks2.map((c, j) => `${c} ${(j / marks2.length) * 360}deg ${((j + 1) / marks2.length) * 360}deg`).join(",")})`,
                  }
                : undefined
            }
            onClick={() => onSelectCell(i)}
            title={`(${row}, ${col}) diff=${cd.difficulty}`}
          >
            <span className="et-cell-diff">{cd.difficulty}</span>
            {marks2.length > 0 && (
              <span className="et-cell-dots">
                {marks2.map((c, j) => (
                  <span
                    key={j}
                    className="et-cell-dot"
                    style={{ background: c }}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── main component ─────────────────────────────────────────────────── */

export default function ExpressionTester() {
  const [expr, setExpr] = useState("cell.difficulty * 2");

  // Editor state
  const [cells, setCells] = useState<CellData[]>(defaultCells);
  const [players] = useState<PlayerRef[]>(DEFAULT_PLAYERS);
  const [bingos] = useState<BingoRef[]>(DEFAULT_BINGOS);
  const [marks, setMarks] = useState<Record<string, number[]>>(DEFAULT_MARKS);
  const [bingoPlayers, setBingoPlayers] = useState<Record<string, number[]>>(
    DEFAULT_BINGO_PLAYERS,
  );
  const [curCellIdx, setCurCellIdx] = useState(12); // center
  const [curPlayerIdx, setCurPlayerIdx] = useState(0);
  const [curBingoIdx, setCurBingoIdx] = useState(0);

  const curCell = cells[curCellIdx];
  const curBingo = curBingoIdx >= 0 ? bingos[curBingoIdx] : null;

  const ctx = buildContext(
    cells,
    players,
    bingos,
    marks,
    bingoPlayers,
    curCellIdx,
    curPlayerIdx,
    curBingoIdx,
  );

  const astResult = parseExpr(expr);
  const evalResult = evalExpr(astResult, ctx);

  // Mutators
  const markCell = (playerIdx: number) => {
    setMarks((prev) => {
      const key = String(playerIdx);
      const cur = prev[key] ?? [];
      if (cur.includes(curCellIdx)) {
        return { ...prev, [key]: cur.filter((i) => i !== curCellIdx) };
      }
      return { ...prev, [key]: [...cur, curCellIdx] };
    });
  };

  const setCellDifficulty = (d: number) => {
    setCells((prev) => {
      const next = [...prev];
      next[curCellIdx] = { ...next[curCellIdx], difficulty: d };
      return next;
    });
  };

  const setCellCounter = (c: number) => {
    setCells((prev) => {
      const next = [...prev];
      next[curCellIdx] = { ...next[curCellIdx], counter: c };
      return next;
    });
  };

  const toggleBingoPlayer = (playerIdx: number) => {
    if (!curBingo) return;
    const key = bingoKey(curBingo);
    setBingoPlayers((prev) => {
      const cur = prev[key] ?? [];
      if (cur.includes(playerIdx)) {
        return { ...prev, [key]: cur.filter((i) => i !== playerIdx) };
      }
      return { ...prev, [key]: [...cur, playerIdx] };
    });
  };

  return (
    <div className="et-page">
      {/* Expression */}
      <div className="et-panel">
        <h1 className="et-title">Expression Tester</h1>

        <div className="et-section">
          <label className="et-label">Expression</label>
          <input
            className="et-expr-input"
            type="text"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="e.g. cell.difficulty * 2"
            autoFocus
          />
        </div>

        <div className="et-section">
          <label className="et-label">
            Result{" "}
            <span className="et-result-badge">
              {ctx.cell ? `cell(${ctx.cell.row},${ctx.cell.col})` : ""}
              {" · "}
              {ctx.player.color}
              {ctx.bingo
                ? ` · bingo(${ctx.bingo.type} ${ctx.bingo.index})`
                : ""}
            </span>
          </label>
          {evalResult?.ok ? (
            <pre className="et-pre et-pre--ok">
              {formatResult(evalResult.value)}
            </pre>
          ) : evalResult ? (
            <pre className="et-pre et-pre--err">{evalResult.error}</pre>
          ) : (
            <pre className="et-pre et-pre--err">
              {astResult.ok ? "" : astResult.error}
            </pre>
          )}
        </div>

        <details className="et-section">
          <summary className="et-label" style={{ cursor: "pointer" }}>
            AST
          </summary>
          {astResult.ok ? (
            <pre className="et-pre et-pre--ok">
              {JSON.stringify(astResult.ast, null, 2)}
            </pre>
          ) : (
            <pre className="et-pre et-pre--err">{astResult.error}</pre>
          )}
        </details>
      </div>

      {/* Context */}
      <div className="et-panel">
        <h2 className="et-title">Context</h2>

        {/* Board */}
        <div className="et-section">
          <label className="et-label">
            Board{" "}
            <span className="et-label-hint">
              (click cell to select · current = thick border · bingo line =
              highlighted)
            </span>
          </label>
          <BoardGrid
            cells={cells}
            marks={marks}
            players={players}
            curCellIdx={curCellIdx}
            curBingo={curBingo}
            onSelectCell={setCurCellIdx}
          />
        </div>

        {/* Cell editor */}
        <div className="et-section">
          <label className="et-label">
            Cell ({Math.floor(curCellIdx / 5)}, {curCellIdx % 5})
          </label>
          <div className="et-row">
            <label className="et-mini-label">
              Diff
              <input
                className="et-num"
                type="number"
                min={1}
                max={5}
                value={curCell.difficulty}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 1 && v <= 5) setCellDifficulty(v);
                }}
              />
            </label>
            <label className="et-mini-label">
              Ctr
              <input
                className="et-num"
                type="number"
                min={0}
                value={curCell.counter}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 0) setCellCounter(v);
                }}
              />
            </label>
            <div className="et-mini-label">
              <span>Marks</span>
              <div className="et-mark-toggles">
                {players.map((p, i) => {
                  const active = (marks[String(i)] ?? []).includes(curCellIdx);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`et-mark-btn${active ? " et-mark-btn--on" : ""}`}
                      style={
                        active
                          ? { background: p.color, borderColor: p.color }
                          : { borderColor: p.color + "66" }
                      }
                      onClick={() => markCell(i)}
                      title={p.color}
                    >
                      {p.color}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Player selector */}
        <div className="et-section">
          <label className="et-label">Player</label>
          <div className="et-row et-row--wrap">
            {players.map((p, i) => (
              <button
                key={i}
                type="button"
                className={`et-player-btn${i === curPlayerIdx ? " et-player-btn--cur" : ""}`}
                style={{
                  borderColor:
                    i === curPlayerIdx ? p.color : "var(--border-color, #ccc)",
                  background: i === curPlayerIdx ? p.color + "18" : undefined,
                }}
                onClick={() => setCurPlayerIdx(i)}
              >
                <span
                  className="et-player-dot"
                  style={{ background: p.color }}
                />
                {p.color}
              </button>
            ))}
          </div>
        </div>

        {/* Bingo selector */}
        <div className="et-section">
          <label className="et-label">Bingo</label>
          <div className="et-row et-row--wrap">
            <button
              type="button"
              className={`et-player-btn${curBingoIdx < 0 ? " et-player-btn--cur" : ""}`}
              onClick={() => setCurBingoIdx(-1)}
            >
              none
            </button>
            {bingos.map((b, i) => (
              <button
                key={i}
                type="button"
                className={`et-player-btn${i === curBingoIdx ? " et-player-btn--cur" : ""}`}
                onClick={() => setCurBingoIdx(i)}
              >
                {b.type} {b.index}
              </button>
            ))}
          </div>
          {curBingo && (
            <div className="et-mini-label" style={{ marginTop: 4 }}>
              <span>Players on this bingo:</span>
              <div className="et-mark-toggles">
                {players.map((p, i) => {
                  const active = (
                    bingoPlayers[bingoKey(curBingo)] ?? []
                  ).includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`et-mark-btn${active ? " et-mark-btn--on" : ""}`}
                      style={
                        active
                          ? { background: p.color, borderColor: p.color }
                          : { borderColor: p.color + "66" }
                      }
                      onClick={() => toggleBingoPlayer(i)}
                      title={p.color}
                    >
                      {p.color}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
