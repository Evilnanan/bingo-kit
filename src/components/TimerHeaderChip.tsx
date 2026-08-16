import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { computeTimerSeconds, formatTimer } from "../utils/roomTimer";
import { estimatedServerNow } from "../utils/serverClock";
import { StopwatchIcon } from "./icons";
import type { RoomTimerState } from "../types";
import "./TimerPanel.css";

interface Props {
  /** Server-authoritative room timer state. */
  timer: RoomTimerState;
  /** Restore the floating timer window (and expand it). Receives the chip's
   *  bounding rect so the window can open right next to the clicked chip. */
  onClick: (anchor: DOMRect) => void;
}

/**
 * The minimized-to-top-bar form of the room timer: a compact chip showing
 * the current time (+ a status dot); before any timer has started it shows
 * only an alarm icon. Clicking it restores the floating window. Self-ticking
 * while a timer runs — the sampled server-clock value is kept in state and
 * read during render, so the React Compiler can't memoize the display as
 * frozen (see TimerPanel for the same pattern).
 */
export function TimerHeaderChip({ timer, onClick }: Props) {
  const { t } = useT();
  const running = timer.status === "running";
  // Re-sample the estimated server clock ~4×/s while running and keep the
  // value in state: the display derives from this sampled value, so the
  // React Compiler's memoization sees it change and re-renders the time.
  // (A tick counter that the render never reads would be memoized away —
  // the classic "time frozen until the next interaction" symptom.) The
  // sample freezes while paused (the interval is stopped), so the first
  // tick after a resume/start fires immediately (delay 0) — otherwise the
  // first frames would derive the remaining time from a stale "now" and a
  // countdown would jump back by the whole paused duration.
  const [serverNow, setServerNow] = useState(() => estimatedServerNow());
  useEffect(() => {
    if (!running) return;
    const tick = () => setServerNow(estimatedServerNow());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [running]);

  const seconds = computeTimerSeconds(timer, serverNow);

  // No timer started yet: keep the chip minimal — just a stopwatch icon, no
  // "--:--" placeholder and no status dot.
  if (timer.status === "idle") {
    return (
      <button
        type="button"
        className="timer-header-chip timer-header-chip--idle"
        onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
        title={t["timer.restore"]}
        aria-label={t["timer.title"]}
      >
        <StopwatchIcon />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="timer-header-chip"
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      title={t["timer.restore"]}
    >
      <span
        className="timer-status-dot"
        data-status={timer.status}
        aria-hidden="true"
      />
      <span>{seconds != null ? formatTimer(seconds) : "--:--"}</span>
    </button>
  );
}
