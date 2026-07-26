import { measureTextWidth } from "./measureText";

/**
 * Find the largest font size (≤ baseFontSize, ≥ 1) where the text fits
 * within the square cell's available area. Uses binary search.
 *
 * Uses 90 % of availableWidth / 94 % of availableHeight as effective area
 * to account for Canvas-to-DOM font rendering differences.
 *
 * Does NOT return a line-clamp value — the browser handles line wrapping
 * naturally, and the CSS clips overflow via max-height.
 */
export function fitSquareText(
  text: string,
  baseFontSize: number,
  availableWidth: number,
  availableHeight: number,
  fontFamily: string,
): number {
  const lineHeight = 1.3;
  const effectiveWidth = availableWidth * 0.9;
  const effectiveHeight = availableHeight * 0.94;

  /** Estimate rendered height at a given font size (Canvas-based). */
  function estimatedHeight(fontSize: number): number {
    const totalWidth = measureTextWidth(text, fontSize, fontFamily);
    const lines = Math.max(1, Math.ceil(totalWidth / effectiveWidth));
    return lines * fontSize * lineHeight;
  }

  let lo = 1;
  let hi = baseFontSize;
  let best = 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (estimatedHeight(mid) <= effectiveHeight) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}
