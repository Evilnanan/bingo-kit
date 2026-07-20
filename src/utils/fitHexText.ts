import { measureTextWidth } from "./measureText";

export interface HexFitResult {
  fontSize: number;
  lineClamp: number;
}

/**
 * Find the optimal (fontSize, lineClamp) so the text fits inside a hex cell.
 *
 * Strategy: alternate between shrinking font and adding lines.
 * - Shrink up to 2 px before adding a line (keeps text readable for as long as possible).
 * - After adding a line, reset the shrink budget so the next round shrinks again.
 * - Stops when font reaches 7 px and all possible lines are exhausted.
 */
export function fitHexText(
  text: string,
  baseFontSize: number,
  availableWidth: number,
  availableHeight: number,
  fontFamily: string,
): HexFitResult {
  /**
   * Whether `text` fits at the given (fontSize, lineClamp).
   *
   * Uses 85 % of availableWidth as the effective line width.
   * The 15 % safety margin accounts for:
   *  - Hex corner clipping: top/bottom lines have ~75 % of full width
   *  - Canvas-to-DOM font rendering differences (~3-5 %)
   */
  const effectiveWidth = availableWidth * 0.85;

  function fits(fontSize: number, lineClamp: number): boolean {
    const totalWidth = measureTextWidth(text, fontSize, fontFamily);
    const linesNeeded = Math.max(1, Math.ceil(totalWidth / effectiveWidth));
    return linesNeeded <= lineClamp;
  }

  const lineHeight = 1.15;

  // --- base case: text fits at base font with default 3 lines ---
  if (fits(baseFontSize, 3)) {
    return { fontSize: baseFontSize, lineClamp: 3 };
  }

  // --- alternating strategy for long text ---
  let fontSize = baseFontSize;
  let lineClamp = 3;
  let shrinkBudget = 2; // px we're allowed to shrink before adding a line

  while (fontSize >= 7) {
    const maxLinesPossible = Math.floor(
      availableHeight / (fontSize * lineHeight),
    );
    // effectiveClamp: never go below 3, never exceed 6 or physical height limit
    const effectiveClamp = Math.min(
      6,
      Math.max(3, Math.min(lineClamp, maxLinesPossible)),
    );

    if (fits(fontSize, effectiveClamp)) {
      return { fontSize, lineClamp: effectiveClamp };
    }

    // Doesn't fit — prioritise shrinking
    if (fontSize > 7 && shrinkBudget > 0) {
      fontSize--;
      shrinkBudget--;
    }
    // Shrink budget exhausted → add a line, reset budget
    else if (lineClamp < Math.min(6, maxLinesPossible)) {
      lineClamp++;
      shrinkBudget = 2;
    }
    // Line count maxed out → keep shrinking
    else if (fontSize > 7) {
      fontSize--;
      shrinkBudget = 2;
    }
    // fontSize=7, max lines reached, still doesn't fit — give up
    else {
      break;
    }
  }

  // Fallback: smallest font + as many lines as physically possible
  const maxLines = Math.floor(availableHeight / (7 * lineHeight));
  return { fontSize: 7, lineClamp: Math.min(6, Math.max(3, maxLines)) };
}
