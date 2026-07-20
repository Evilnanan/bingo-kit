import type { ScoringRule } from "./types";

/**
 * Default scoring rule: 1 point per marked cell.
 * Used as fallback when no custom rule is provided,
 * and always for Hex mode.
 */
export const DEFAULT_SCORING_RULE: ScoringRule = {
  id: "default",
  name: "Default",
  items: [
    {
      id: "default-cell",
      target: "cell",
      points: "1",
      label: "Per cell",
    },
  ],
};
