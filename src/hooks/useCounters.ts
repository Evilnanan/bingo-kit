import { useEffect, useRef } from "react";
import type { GoalItem } from "../types";
import { getGoalCounter } from "../types";
import { useLongPressAlt } from "./useLongPress";

/**
 * Counter handlers backed by shared (synced) state.
 * Left-click increments, right-click / long-press decrements.
 * `counters` / `onChange` come from the room so progress is shared across
 * the same player's devices.
 */
export function useCounters(
  goals: GoalItem[],
  counters: Record<number, number>,
  onChange: (idx: number, value: number) => void,
) {
  // Long-press fires from a timer, so always read the latest state/emit fn.
  const latestRef = useRef({ counters, onChange });
  useEffect(() => {
    latestRef.current = { counters, onChange };
  });

  const counterAlt = useLongPressAlt((idx: number) => {
    const { counters: latest, onChange: emit } = latestRef.current;
    const cur = latest[idx] ?? 0;
    const max = getGoalCounter(goals[idx]);
    if (max <= 0) return;
    const next = Math.max(0, Math.min(max, cur - 1));
    if (next === cur) return;
    emit(idx, next);
  });

  const updateCounter = (idx: number, delta: number) => {
    const { counters: latest, onChange: emit } = latestRef.current;
    const cur = latest[idx] ?? 0;
    const max = getGoalCounter(goals[idx]);
    if (max <= 0) return;
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next === cur) return;
    emit(idx, next);
  };

  const handleClick = (idx: number) => {
    if (counterAlt.consumed()) return;
    updateCounter(idx, 1);
  };

  const handleContextMenu = (idx: number) => {
    counterAlt.tryAlt(idx);
  };

  const handleTouchStart = (idx: number) => {
    counterAlt.start(idx);
  };

  const handleTouchEnd = () => {
    counterAlt.cancel();
  };

  return {
    handleClick,
    handleContextMenu,
    handleTouchStart,
    handleTouchEnd,
  } as const;
}
