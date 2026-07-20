import { useState } from "react";
import type { GoalItem } from "../types";
import { getGoalCounter } from "../types";
import { useLongPressAlt } from "./useLongPress";

/**
 * Shared counter state and handlers.
 * Left-click increments, right-click / long-press decrements.
 */
export function useCounters(goals: GoalItem[]) {
  const [counters, setCounters] = useState<Record<number, number>>({});

  const counterAlt = useLongPressAlt((idx: number) => {
    setCounters((prev) => {
      const cur = prev[idx] ?? 0;
      const max = getGoalCounter(goals[idx]);
      if (max <= 0) return prev;
      const next = Math.max(0, Math.min(max, cur - 1));
      if (next === cur) return prev;
      const updated = { ...prev, [idx]: next };
      if (next === 0) delete updated[idx];
      return updated;
    });
  });

  const updateCounter = (idx: number, delta: number) => {
    setCounters((prev) => {
      const cur = prev[idx] ?? 0;
      const max = getGoalCounter(goals[idx]);
      if (max <= 0) return prev;
      const next = Math.max(0, Math.min(max, cur + delta));
      if (next === cur) return prev;
      const updated = { ...prev, [idx]: next };
      if (next === 0) delete updated[idx];
      return updated;
    });
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
    counters,
    handleClick,
    handleContextMenu,
    handleTouchStart,
    handleTouchEnd,
  } as const;
}
