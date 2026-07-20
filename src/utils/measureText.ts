const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d")!;

/** Read the sans-serif font stack from the :root --sans CSS variable (cached). */
let cachedFontFamily: string | null = null;
export function getSystemFontFamily(): string {
  if (!cachedFontFamily) {
    cachedFontFamily =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--sans")
        .trim() || "system-ui, sans-serif";
  }
  return cachedFontFamily;
}

/** Measure the rendered pixel width of `text` at the given font-size and family. Results are cached per unique key. */
const cache = new Map<string, number>();

export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
): number {
  const key = `${fontSize}|${fontFamily}|${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  ctx.font = `${fontSize}px ${fontFamily}`;
  const width = ctx.measureText(text).width;
  cache.set(key, width);
  return width;
}
