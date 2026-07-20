export const PLAYER_COLORS = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#ca8a04", // yellow
  "#ea580c", // orange
  "#9333ea", // purple
  "#0891b2", // cyan
  "#d946ef", // magenta
  "#65a30d", // lime
  "#4f46e5", // indigo
];

export function getPlayerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export const TEAM_COLORS = {
  red: "#dc2626",
  blue: "#2563eb",
} as const;

export type Team = "red" | "blue";

export function assignLeastUsedColor(
  players: Record<string, { color: string }>,
  colorList: string[],
): string {
  const counts = new Map<string, number>();
  for (const color of colorList) {
    counts.set(color, 0);
  }
  for (const p of Object.values(players)) {
    counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  }
  let minCount = Infinity;
  let bestColor = colorList[0];
  for (const color of colorList) {
    const count = counts.get(color) ?? 0;
    if (count < minCount) {
      minCount = count;
      bestColor = color;
    }
  }
  return bestColor;
}

export const LOCKOUT_COLOR_CLASS: Record<string, string> = {
  "#2563eb": "blue",
  "#dc2626": "red",
  "#4f46e5": "indigo",
  "#16a34a": "green",
  "#ea580c": "orange",
  "#9333ea": "purple",
  "#0891b2": "cyan",
  "#d946ef": "magenta",
  "#ca8a04": "yellow",
  "#65a30d": "lime",
};
