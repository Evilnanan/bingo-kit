import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { Player, GoalItem, MarkEntry } from "../types";
import {
  getGoalText,
  getGoalTooltip,
  getGoalDifficulty,
  getGoalCounter,
} from "../types";
import { useLongPressAlt, makeCellEventHandlers } from "../hooks/useLongPress";
import { useCounters } from "../hooks/useCounters";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { BingoSquare, type ColorSegment } from "./BingoSquare";
import "./BingoBoard.css";

/** Minimum midline ratio for a player in a multi-mark cell. */
const MIN_SEGMENT_RATIO = 0.2;

interface Props {
  goals: GoalItem[];
  marks: Record<number, MarkEntry[]>;
  lockout: boolean;
  players: Record<string, Player>;
  localPlayerName: string | null;
  onMarkSquare: (index: number) => void;
  cellScores: Record<number, Record<string, number>>;
  settings: RoomSettings;
}

// ============================================================
// Segment width computation
// ============================================================
//
// Dividing lines between color segments are diagonal with slope H/(W/2).
// A dividing line at fraction c goes from (c·W, 0) to ((c-0.5)·W, H).
// The natural right boundary is c = 1.5, whose bottom endpoint is exactly
// the cell's bottom-right corner. We therefore scale widths so cum[N] = 1.5.
//
// Each segment's top-edge width is directly proportional to its score ratio.
// A minimum width of MIN_SEGMENT_RATIO is enforced so every segment remains
// visible (and tappable) even with highly skewed scores.

/**
 * Pick the border color for a multi-mark cell: the color with the highest
 * score on this cell. Ties are broken by earliest mark timestamp.
 *
 * Scores are keyed by color (cellScores[cellIndex][color] → points), so
 * lookup is direct — no color→player mapping needed.
 */
function computeBorderColor(
  markerEntries: MarkEntry[],
  cellScoresForCell: Record<string, number> | undefined,
): string | undefined {
  if (markerEntries.length === 0) return undefined;

  // Sort by timestamp first (tie-breaker), then pick max score
  const sorted = [...markerEntries].sort((a, b) => a.timestamp - b.timestamp);

  let bestColor = sorted[0].by;
  let bestScore = -1;

  for (const entry of sorted) {
    const score = cellScoresForCell?.[entry.by] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestColor = entry.by;
    }
  }

  return bestColor;
}

/**
 * Compute color segments for a cell in non-lockout mode.
 *
 * Segments are ordered by mark timestamp (left → right). Each segment's
 * top-edge width is proportional to the score the color earned from this
 * cell, with a minimum ratio of MIN_SEGMENT_RATIO.
 *
 * Scores are keyed by color directly (from calculateCellScores), so
 * lookup is `cellScoresForCell?.[color]` — no player name needed.
 */
function computeColorSegments(
  markerEntries: MarkEntry[],
  cellScoresForCell: Record<string, number> | undefined,
): ColorSegment[] {
  const sorted = [...markerEntries].sort((a, b) => a.timestamp - b.timestamp);
  const entries = sorted.map((e) => ({ color: e.by }));

  if (entries.length === 0) return [];
  const N = entries.length;

  // Step 1: compute desired widths from scores
  const rawScores = entries.map((e) => cellScoresForCell?.[e.color] ?? 0);

  const totalScore = rawScores.reduce((a, b) => a + b, 0);

  let widths: number[];
  if (totalScore === 0) {
    widths = entries.map(() => 1 / N);
  } else {
    const raw = rawScores.map((s) =>
      Math.max(MIN_SEGMENT_RATIO, s / totalScore),
    );
    const rawSum = raw.reduce((a, b) => a + b, 0);
    widths = raw.map((r) => r / rawSum);
  }

  // Step 2: scale to diagonal coordinate system (total = 1.5)
  return entries.map((e, i) => ({
    color: e.color,
    width: widths[i] * 1.5,
  }));
}

export function BingoBoard({
  goals,
  marks,
  lockout,
  players,
  localPlayerName,
  onMarkSquare,
  cellScores,
  settings,
}: Props) {
  const { lang } = useT();
  const [starMarks, setStarMarks] = useState<Set<number>>(new Set());

  const {
    counters,
    handleClick: handleCounterClick,
    handleContextMenu: handleCounterContextMenu,
    handleTouchStart: handleCounterTouchStart,
    handleTouchEnd: handleCounterTouchEnd,
  } = useCounters(goals);

  const toggleStarMark = (index: number) => {
    setStarMarks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const markAlt = useLongPressAlt(toggleStarMark);

  // ---- Widget scale from board size (uniform across all 25 cells) ----
  const boardRef = useRef<HTMLDivElement>(null);
  const [widgetScale, setWidgetScale] = useState(1);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width: bw, height: bh } = entry.contentRect;
      // Approximate cell size from board dimensions (5×5 grid with gap).
      // Gaps are small relative to cells, so bw/5 is close enough.
      const cellW = bw / 5;
      const cellH = bh / 5;
      const scale = Math.max(
        0.5,
        Math.min(1.5, Math.min(cellW, cellH) / 130),
      );
      setWidgetScale(scale);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Local player's color — used for hover border
  const localPlayerColor = localPlayerName
    ? players[localPlayerName]?.color
    : undefined;

  return (
    <div className="board" ref={boardRef}>
      {goals.map((goalItem, i) => {
        const markerEntries = marks[i] || [];
        const cellScoresForCell = cellScores[i];

        let colorSegments: ColorSegment[];
        let borderColor: string | undefined;

        if (lockout) {
          // Lockout mode: single color segment for the first (only) marker
          const firstEntry = markerEntries[0];
          colorSegments = firstEntry
            ? [{ color: firstEntry.by, width: 1 }]
            : [];
          borderColor = firstEntry?.by;
        } else {
          // Non-lockout mode: multi-color segments based on score ratios
          colorSegments = computeColorSegments(
            markerEntries,
            cellScoresForCell,
          );
          // Border color = highest-scoring color on this cell (ties → earliest mark)
          borderColor = computeBorderColor(markerEntries, cellScoresForCell);
        }

        const counter = getGoalCounter(goalItem);

        return (
          <BingoSquare
            key={i}
            goal={getGoalText(goalItem, lang)}
            tooltip={getGoalTooltip(goalItem, lang)}
            difficulty={getGoalDifficulty(goalItem)}
            colorSegments={colorSegments}
            borderColor={borderColor}
            hoverColor={localPlayerColor}
            isStarMarked={starMarks.has(i)}
            counter={counter}
            counterValue={counter > 0 ? (counters[i] ?? 0) : 0}
            counterHandlers={{
              onClick: () => handleCounterClick(i),
              onContextMenu: () => handleCounterContextMenu(i),
              onTouchStart: () => handleCounterTouchStart(i),
              onTouchEnd: handleCounterTouchEnd,
            }}
            hideCounter={settings.hideCounters}
            hideTooltip={settings.hideTooltips}
            userFontScale={settings.fontScale}
            widgetScale={widgetScale}
            {...makeCellEventHandlers(markAlt, onMarkSquare, i)}
          />
        );
      })}
    </div>
  );
}
