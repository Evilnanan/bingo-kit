import type { RoomTimerState } from "../types";
import { estimatedServerNow } from "./serverClock";

/**
 * Seconds to display for the current timer of the server-authoritative state:
 * countdown → remaining (clamped at 0), count-up → elapsed. Derived from the
 * estimated server clock whenever the timer is running. Returns null when
 * nothing is active (no current timer).
 *
 * `now` may be supplied by the caller (a freshly sampled server-clock value
 * held in state); it defaults to a live `estimatedServerNow()` call. Callers
 * that tick must pass their sampled value, otherwise the React Compiler can
 * memoize the render output as unchanged and the display freezes.
 */
export function computeTimerSeconds(
  timer: RoomTimerState,
  now?: number,
): number | null {
  const nowMs = now ?? estimatedServerNow();
  const current =
    timer.currentIndex >= 0 && timer.currentIndex < timer.timers.length
      ? timer.timers[timer.currentIndex]
      : null;
  if (!current) return null;
  if (current.mode === "countdown") {
    if (timer.status === "running" && timer.endAt != null) {
      // Clamp to [0, duration]: the client's server-clock estimate can lag a
      // few ms behind, and ceil() would otherwise flash duration+1 (a 40 s
      // timer briefly showing 00:41) until the next clock sample corrects it.
      return Math.min(
        current.duration,
        Math.max(0, Math.ceil((timer.endAt - nowMs) / 1000)),
      );
    }
    if (timer.status === "finished") return timer.pausedRemaining ?? 0;
    return timer.pausedRemaining ?? current.duration;
  }
  if (timer.status === "running" && timer.startedAt != null) {
    return Math.max(0, Math.floor((nowMs - timer.startedAt) / 1000));
  }
  return timer.pausedElapsed ?? 0;
}

/** Format whole seconds as MM:SS, or H:MM:SS once an hour is reached. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
