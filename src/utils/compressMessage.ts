import LZString from "lz-string";

/**
 * Serialize data to JSON and compress to a base64-safe string.
 * The output is safe to embed as a JSON field value.
 */
export function compressJson<T>(data: T): string {
  return LZString.compressToBase64(JSON.stringify(data));
}

/**
 * Decompress a base64 string (produced by compressJson) and parse back to the original type.
 * Returns null on any failure (corrupted data, invalid JSON, etc.).
 */
export function decompressJson<T>(compressed: string): T | null {
  try {
    const json = LZString.decompressFromBase64(compressed);
    if (json === null || json === "") return null;
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
