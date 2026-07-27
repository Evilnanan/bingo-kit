import { useState } from "react";

export interface RoomSettings {
  hideCounters: boolean;
  hideTooltips: boolean;
  fontScale: number;
}

const KEY = "bingo-room-settings";
const DEFAULTS: RoomSettings = {
  hideCounters: false,
  hideTooltips: false,
  fontScale: 1.0,
};

function readSettings(): RoomSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        hideCounters:
          typeof parsed.hideCounters === "boolean"
            ? parsed.hideCounters
            : DEFAULTS.hideCounters,
        hideTooltips:
          typeof parsed.hideTooltips === "boolean"
            ? parsed.hideTooltips
            : DEFAULTS.hideTooltips,
        fontScale:
          typeof parsed.fontScale === "number" &&
          !isNaN(parsed.fontScale) &&
          parsed.fontScale >= 0.5 &&
          parsed.fontScale <= 2.0
            ? parsed.fontScale
            : DEFAULTS.fontScale,
      };
    }
  } catch {
    /* noop */
  }
  return DEFAULTS;
}

function saveSettings(s: RoomSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

export function useRoomSettings() {
  const [settings, setSettings] = useState<RoomSettings>(readSettings);

  const updateSetting = <K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K],
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  return { settings, updateSetting };
}
