import { measureTextWidth } from "./measureText";

const LINE_HEIGHT = 1.15;

export interface HexLine {
  text: string;
  /** Pixel max-width for this line (inline style). */
  maxWidth: number;
}

export interface HexTextLayout {
  lines: HexLine[];
  fontSize: number;
}

/**
 * Hex interior width at normalised vertical position y.
 * y ∈ [0, 1]  where 0 = top of the hex, 1 = bottom.
 *
 * The hex clip-path is polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%),
 * so the visible width goes linearly from 50 % (top / bottom) to 100 % (middle).
 *
 * We subtract the CSS inset and horizontal padding to get the *usable* text width.
 */
function hexWidthAtY(
  y: number,
  hexWidth: number,
  inset: number,
  paddingX: number,
): number {
  const shapeRatio = 1 - Math.abs(y - 0.5); // 0.5 at edges → 1.0 at middle
  return Math.max(0, hexWidth * shapeRatio - 2 * inset - 2 * paddingX);
}

/**
 * Split source text into breakable segments.
 * CJK characters are broken individually; Latin text is split on whitespace.
 * Returns `{ tokens, sep }` where `sep` is the string to insert between tokens
 * when joining them back onto a line.
 */
function tokenise(text: string): { tokens: string[]; sep: string } {
  if (/[一-鿿぀-ゟ゠-ヿ가-힯]/.test(text)) {
    return { tokens: [...text], sep: "" };
  }
  return { tokens: text.split(/\s+/).filter(Boolean), sep: " " };
}

/**
 * Pre-compute per-line pixel widths for a centred block of `numLines` lines.
 */
function computeLineWidths(
  numLines: number,
  fontSize: number,
  hexWidth: number,
  hexHeight: number,
  inset: number,
  paddingX: number,
  contentH: number,
): number[] {
  const linePixelH = fontSize * LINE_HEIGHT;
  const blockH = numLines * linePixelH;
  const blockTop = (contentH - blockH) / 2 + inset;

  const widths: number[] = [];
  for (let i = 0; i < numLines; i++) {
    const lineCenterY = blockTop + (i + 0.5) * linePixelH;
    const y = lineCenterY / hexHeight;
    widths.push(
      Math.round(
        Math.max(
          0,
          hexWidthAtY(Math.max(0, Math.min(1, y)), hexWidth, inset, paddingX),
        ),
      ),
    );
  }
  return widths;
}

/**
 * Try to greedily fit all tokens into exactly `numLines` lines whose widths
 * follow the hex contour.  Returns the line array on success, `null` if the
 * text overflows.
 */
function tryFitLines(
  tokens: string[],
  sep: string,
  numLines: number,
  lineWidths: number[],
  fontSize: number,
  fontFamily: string,
): HexLine[] | null {
  const sepW = sep ? measureTextWidth(sep, fontSize, fontFamily) : 0;

  const out: HexLine[] = [];
  let cur = "";
  let curW = 0;
  let li = 0; // current line index

  for (const tok of tokens) {
    if (li >= numLines) return null;

    const tokW = measureTextWidth(tok, fontSize, fontFamily);
    const gapW = cur ? sepW : 0;
    const lineMaxW = lineWidths[li];

    if (cur && curW + gapW + tokW > lineMaxW) {
      // Finish current line, start a new one
      out.push({ text: cur, maxWidth: lineWidths[li] });
      li++;
      if (li >= numLines) return null;
      cur = tok;
      curW = tokW;
    } else {
      cur = cur ? cur + sep + tok : tok;
      curW = cur ? measureTextWidth(cur, fontSize, fontFamily) : 0;
    }
  }

  // Push the final line — only succeeds if there's still room.
  if (cur && li < numLines) {
    out.push({ text: cur, maxWidth: lineWidths[li] });
    li++;
  } else if (cur) {
    return null;
  }

  return out;
}

/**
 * Try to lay out text into the fewest possible lines (minimum 1, maximum
 * maxLines).  Each candidate line-count N gets a centred block; line widths
 * are computed from the hex contour at each line's vertical position.
 *
 * Returns the line array on success, `null` if text doesn't fit even with
 * maxLines.
 */
function breakLines(
  text: string,
  fontSize: number,
  hexWidth: number,
  hexHeight: number,
  inset: number,
  paddingX: number,
  fontFamily: string,
): HexLine[] | null {
  const contentH = hexHeight - 2 * inset;
  const linePixelH = fontSize * LINE_HEIGHT;
  const maxLines = Math.floor(contentH / linePixelH);
  if (maxLines <= 0) return null;

  const { tokens, sep } = tokenise(text);
  if (tokens.length === 0) return [];

  // Try 1 line → 2 lines → … → maxLines.  First fit wins = fewest lines.
  for (let n = 1; n <= maxLines; n++) {
    const lineWidths = computeLineWidths(
      n,
      fontSize,
      hexWidth,
      hexHeight,
      inset,
      paddingX,
      contentH,
    );
    const result = tryFitLines(
      tokens,
      sep,
      n,
      lineWidths,
      fontSize,
      fontFamily,
    );
    if (result) return result;
  }

  return null;
}

/**
 * Lay out text into hex-shaped lines at a given font size.
 * Returns `null` if the text doesn't fit vertically at this size.
 */
export function layoutHexText(
  text: string,
  fontSize: number,
  hexWidth: number,
  hexHeight: number,
  inset: number,
  paddingX: number,
  fontFamily: string,
): HexLine[] | null {
  if (!text) return [];
  return breakLines(
    text,
    fontSize,
    hexWidth,
    hexHeight,
    inset,
    paddingX,
    fontFamily,
  );
}

/**
 * Find the largest font size (≤ baseFontSize, ≥ 1) where hex-shaped text fits,
 * and return both the line layout and chosen font size.
 */
export function fitHexText(
  text: string,
  baseFontSize: number,
  hexWidth: number,
  hexHeight: number,
  inset: number,
  paddingX: number,
  fontFamily: string,
): HexTextLayout {
  if (!text) {
    return { lines: [], fontSize: baseFontSize };
  }

  // Try base size first
  const atBase = breakLines(
    text,
    baseFontSize,
    hexWidth,
    hexHeight,
    inset,
    paddingX,
    fontFamily,
  );
  if (atBase) {
    return { lines: atBase, fontSize: baseFontSize };
  }

  // Binary-search downward for largest fitting size
  let lo = 1;
  let hi = baseFontSize - 1;
  let best: HexLine[] | null = null;
  let bestSize = 1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = breakLines(
      text,
      mid,
      hexWidth,
      hexHeight,
      inset,
      paddingX,
      fontFamily,
    );
    if (lines) {
      best = lines;
      bestSize = mid;
      lo = mid + 1; // try larger
    } else {
      hi = mid - 1;
    }
  }

  return {
    lines: best ?? [
      { text, maxWidth: Math.round(hexWidth * 0.5 - 2 * inset - 2 * paddingX) },
    ],
    fontSize: bestSize,
  };
}
