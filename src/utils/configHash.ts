/**
 * Deterministic hash of a string, used as a content fingerprint.
 * Not cryptographically secure — only for matching identical configs.
 */
export function hashString(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Compute a config hash from the restart-relevant settings.
 * Only devices that can reproduce this hash are allowed to restart the room.
 */
export function computeConfigHash(params: Record<string, unknown>): string {
  // Sort keys for deterministic serialization
  const payload = JSON.stringify(params, (_, v) => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      return Object.keys(v)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
  return hashString(payload);
}
