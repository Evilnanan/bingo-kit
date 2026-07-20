import type { GoalPool } from "../types";

const STORAGE_KEY = "bingo-goal-pools";

export function loadPools(): GoalPool[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed as GoalPool[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function savePools(pools: GoalPool[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pools));
  } catch {
    /* ignore */
  }
}
