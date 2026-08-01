import type { GoalPool } from "../types";
import { getGoalImages, stripImageData } from "../types";
import { storeImageData, isAvailable } from "./imageDataStore";

const STORAGE_KEY = "bingo-goal-pools";

/**
 * Fire-and-forget: persist every image's base64 data to IndexedDB.
 * localStorage only keeps {hash, filename, mimeType} metadata;
 * the data itself lives in IndexedDB keyed by hash.
 */
function persistImageData(pools: GoalPool[]): void {
  if (!isAvailable()) return;
  for (const pool of pools) {
    for (const goal of pool.goals) {
      for (const att of getGoalImages(goal)) {
        if (att.data) storeImageData(att).catch(() => {});
      }
    }
  }
}

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
  persistImageData(pools);

  try {
    if (isAvailable()) {
      // IndexedDB holds the image data — localStorage stores stripped metadata
      const stripped = pools.map((pool) => ({
        ...pool,
        goals: stripImageData(pool.goals),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
    } else {
      // IndexedDB unavailable (private mode etc.) — fall back to full data
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pools));
    }
  } catch {
    /* ignore */
  }
}
