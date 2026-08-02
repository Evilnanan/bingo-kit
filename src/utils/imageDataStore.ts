/**
 * IndexedDB storage for goal pool image base64 data.
 *
 * localStorage keeps only {hash, filename, mimeType} metadata; the base64
 * data itself lives here, keyed by SHA-256 hash (dedup: the same image
 * referenced by multiple goals is stored once). Export JSON re-merges data
 * from here so backups survive the R2 30-day lifecycle.
 *
 * All operations are best-effort: failures are swallowed silently so the
 * app degrades to server URLs (getImageSrc) instead of crashing.
 */

import type { GoalItem, ImageAttachment } from "../types";
import { getGoalImages } from "../types";

const DB_NAME = "bingo-image-data";
const DB_VERSION = 1;
const STORE_NAME = "images";

interface ImageRecord {
  hash: string; // SHA-256 hex, primary key
  data: string; // raw base64 (no data: URI prefix)
  storedAt: number;
}

/** Whether IndexedDB is usable (false in some private-browsing modes). */
export function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isAvailable()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Store one image's base64 data (no-op without data). */
export function storeImageData(att: ImageAttachment): Promise<void> {
  if (!att.data) return Promise.resolve();
  const { hash, data } = att;
  return new Promise<void>((resolve) => {
    openDB()
      .then((db) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({
          hash,
          data,
          storedAt: Date.now(),
        } satisfies ImageRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      })
      .catch(() => resolve());
  });
}

async function getImageData(hash: string): Promise<string | undefined> {
  try {
    const db = await openDB();
    return await new Promise<string | undefined>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(hash);
      req.onsuccess = () =>
        resolve((req.result as ImageRecord | undefined)?.data);
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** Read multiple images in parallel; returns only found entries. */
export async function getBatchImageData(
  hashes: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return map;
  await Promise.all(
    unique.map(async (hash) => {
      const data = await getImageData(hash);
      if (data) map.set(hash, data);
    }),
  );
  return map;
}

/** Merge fetched data into an attachment list — only fills missing `data`, never removes. */
export function mergeDataMapIntoAttachments(
  images: ImageAttachment[] | undefined,
  dataMap: Map<string, string>,
): ImageAttachment[] | undefined {
  if (!images || images.length === 0 || dataMap.size === 0) return images;
  let changed = false;
  const result = images.map((a) => {
    if (a.data || !a.hash) return a;
    const d = dataMap.get(a.hash);
    if (d) {
      changed = true;
      return { ...a, data: d };
    }
    return a;
  });
  return changed ? result : images;
}

/** Merge fetched data into goals — only fills missing `data`, never removes. */
export function mergeDataMapIntoGoals(
  goals: GoalItem[],
  dataMap: Map<string, string>,
): GoalItem[] {
  if (dataMap.size === 0) return goals;
  let changed = false;
  const result = goals.map((goal) => {
    if (typeof goal === "string" || !goal.images || goal.images.length === 0)
      return goal;
    const images = mergeDataMapIntoAttachments(goal.images, dataMap);
    if (images !== goal.images) {
      changed = true;
      return { ...goal, images };
    }
    return goal;
  });
  return changed ? result : goals;
}

/**
 * Fetch missing image data from IndexedDB and merge it into goals.
 * Goals whose data is already present are returned unchanged.
 */
export async function mergeDataIntoGoals(
  goals: GoalItem[],
): Promise<GoalItem[]> {
  const hashes = new Set<string>();
  for (const goal of goals) {
    for (const att of getGoalImages(goal)) {
      if (!att.data && att.hash) hashes.add(att.hash);
    }
  }
  if (hashes.size === 0) return goals;
  const dataMap = await getBatchImageData([...hashes]);
  return mergeDataMapIntoGoals(goals, dataMap);
}

/**
 * Fetch missing image data from IndexedDB and merge it into an attachment
 * list (used for pool-level images on export).
 */
export async function mergeDataIntoAttachments(
  images: ImageAttachment[] | undefined,
): Promise<ImageAttachment[] | undefined> {
  if (!images || images.length === 0) return images;
  const hashes = new Set<string>();
  for (const att of images) {
    if (!att.data && att.hash) hashes.add(att.hash);
  }
  if (hashes.size === 0) return images;
  const dataMap = await getBatchImageData([...hashes]);
  return mergeDataMapIntoAttachments(images, dataMap);
}

/**
 * Delete records whose hash is not in `activeHashes` (e.g. after a pool
 * was deleted). Returns the number of deleted records.
 */
export async function deleteOrphanedData(
  activeHashes: Iterable<string>,
): Promise<number> {
  try {
    const db = await openDB();
    const active = new Set(activeHashes);
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      let deleted = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(deleted);
          return;
        }
        if (!active.has((cursor.value as ImageRecord).hash)) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      };
      req.onerror = () => resolve(deleted);
    });
  } catch {
    return 0;
  }
}
