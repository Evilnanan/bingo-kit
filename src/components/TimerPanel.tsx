import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { computeTimerSeconds, formatTimer } from "../utils/roomTimer";
import { estimatedServerNow } from "../utils/serverClock";
import { TimerSetupDialog } from "./TimerSetupDialog";
import { StopwatchIcon } from "./icons";
import type { RoomTimer, RoomTimerState } from "../types";
import "./TimerPanel.css";

interface Props {
  /** Server-authoritative room timer state. */
  timer: RoomTimerState;
  /** Whether the local player is the room owner (only they get controls). */
  isOwner: boolean;
  /** "floating" renders the draggable window; "header" renders nothing here
   *  (the minimized chip lives in the top bar instead). */
  placement: "floating" | "header";
  /** Bounding rect of the header chip that restored the window — the window
   *  opens right next to it. */
  anchor: DOMRect | null;
  /** Floating window expanded (queue + controls) vs collapsed (time only). */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPlacementChange: (placement: "floating" | "header") => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  /** Owner: skip the current timer and start the next one. */
  onNext: () => void;
  onSubmit: (timers: RoomTimer[], submitMode: "append" | "overwrite") => void;
}

interface Pos {
  x: number;
  y: number;
}

/** Clamp a top-left position so a w×h window stays fully inside the viewport
 *  (8px margin). If the window is larger than the viewport itself, it pins to
 *  the top-left corner. */
function clampPos(p: Pos, w: number, h: number): Pos {
  return {
    x: Math.max(8, Math.min(p.x, window.innerWidth - w - 8)),
    y: Math.max(8, Math.min(p.y, window.innerHeight - h - 8)),
  };
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  moved: boolean;
}

/**
 * Room-wide timer as a small floating window that every player sees synced
 * (rendered from absolute server-clock timestamps + a locally estimated clock
 * offset). The owner controls it: start/resume, pause, stop (ends the current
 * timer and auto-starts the next) and queue setup. The window can be dragged
 * anywhere, collapsed to a time-only chip, or minimized into the top bar
 * (see TimerHeaderChip / the headerTimer slot in RoomHeader).
 */
export function TimerPanel({
  timer,
  isOwner,
  placement,
  anchor,
  expanded,
  onExpandedChange,
  onPlacementChange,
  onStart,
  onPause,
  onStop,
  onNext,
  onSubmit,
}: Props) {
  const { t } = useT();
  const [pos, setPos] = useState<Pos>({ x: 8, y: 8 });
  const [setupOpen, setSetupOpen] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const running = timer.status === "running";
  // Re-sample the estimated server clock ~4×/s while running and keep the
  // value in state: the display derives from this sampled value, so the
  // React Compiler's memoization sees it change and re-renders the time.
  // (A tick counter that the render never reads would be memoized away —
  // the classic "time frozen until the next interaction" symptom.) The
  // sample freezes while paused (the interval is stopped), so the first
  // tick after a resume/start fires immediately (delay 0) — otherwise the
  // first frames would derive the remaining time from a stale "now" and a
  // countdown would jump back by the whole paused duration. Throttled
  // background tabs still jump straight to the correct time on resume,
  // because the value comes from absolute timestamps.
  const [serverNow, setServerNow] = useState(() => estimatedServerNow());
  useEffect(() => {
    if (!running || placement !== "floating") return;
    const tick = () => setServerNow(estimatedServerNow());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [running, placement]);

  // ---------- positioning ----------

  // When restored from the header chip, open right below the chip with the
  // right edges aligned, clamped into the viewport. Layout effect so the
  // window never paints at the stale spot first.
  useLayoutEffect(() => {
    if (placement !== "floating" || !anchor) return;
    const el = rootRef.current;
    const w = el?.offsetWidth ?? 320;
    const h = el?.offsetHeight ?? 240;
    setPos(clampPos({ x: anchor.right - w, y: anchor.bottom + 8 }, w, h));
  }, [placement, anchor]);

  // Keep the whole window on-screen. Two things can push it out without any
  // re-render of our own: the browser window resizing, and the floating
  // window itself changing size (expand/collapse, the queue growing — e.g.
  // expanding near the bottom edge would otherwise overflow downward). Watch
  // both and clamp back into the viewport. Bails out (same object) when
  // already inside, so no render loop.
  useEffect(() => {
    if (placement !== "floating") return;
    const el = rootRef.current;
    if (!el) return;
    const clamp = () => {
      setPos((p) => {
        const c = clampPos(p, el.offsetWidth, el.offsetHeight);
        return c.x === p.x && c.y === p.y ? p : c;
      });
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    window.addEventListener("resize", clamp);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [placement]);

  if (placement !== "floating") return null;

  const current =
    timer.currentIndex >= 0 && timer.currentIndex < timer.timers.length
      ? timer.timers[timer.currentIndex]
      : null;
  const hasQueue = timer.timers.length > 0;
  const seconds = computeTimerSeconds(timer, serverNow);
  const progress =
    current?.mode === "countdown" && seconds != null
      ? Math.min(1, Math.max(0, seconds / (current.duration || 1)))
      : null;

  const statusLabel =
    timer.status === "running"
      ? t["timer.running"]
      : timer.status === "paused"
        ? t["timer.paused"]
        : timer.status === "finished"
          ? t["timer.finished"]
          : hasQueue
            ? t["timer.idle"]
            : t["timer.empty"];

  // ---------- dragging ----------

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    const el = rootRef.current;
    setPos(
      clampPos(
        { x: d.origX + dx, y: d.origY + dy },
        el?.offsetWidth ?? 320,
        el?.offsetHeight ?? 240,
      ),
    );
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) {
      // Plain click on the header: toggle expand/collapse.
      onExpandedChange(!expanded);
    }
  };

  // ---------- render ----------

  return (
    <div
      ref={rootRef}
      className={`timer-float${expanded ? "" : " timer-float--collapsed"}`}
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className={`timer-float-head${expanded ? " timer-float-head--expanded" : ""}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title={t["timer.drag"]}
      >
        {expanded ? (
          // Expanded head stays minimal: stopwatch on the left, an explicit
          // collapse button + minimize on the right (clicking the blank area
          // collapses too — see endDrag).
          <>
            <span className="timer-float-icon" aria-hidden="true">
              <StopwatchIcon width={16} height={16} />
            </span>
            <span className="timer-float-actions">
              <button
                type="button"
                className="timer-float-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onExpandedChange(false)}
                title={t["timer.collapse"]}
              >
                ▾
              </button>
              <button
                type="button"
                className="timer-float-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPlacementChange("header")}
                title={t["timer.minimize"]}
              >
                —
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="timer-float-grip" aria-hidden="true">
              ⠿
            </span>
            {current && (
              <span className="timer-float-name">
                {current.name || t["timer.unnamed"]}
              </span>
            )}
            <span
              className="timer-status-dot"
              data-status={timer.status}
              aria-hidden="true"
            />
            <span className="timer-float-time">
              {seconds != null ? formatTimer(seconds) : "--:--"}
            </span>
            <span className="timer-float-actions">
              <button
                type="button"
                className="timer-float-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onExpandedChange(!expanded)}
                title={expanded ? t["timer.collapse"] : t["timer.expand"]}
              >
                {expanded ? "▾" : "▢"}
              </button>
              <button
                type="button"
                className="timer-float-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onPlacementChange("header")}
                title={t["timer.minimize"]}
              >
                —
              </button>
            </span>
          </>
        )}
      </div>

      {expanded && (
        <>
          {current?.mode === "countdown" && progress != null && (
            <div className="timer-progress" aria-hidden="true">
              <div
                className="timer-progress-fill"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <div className="timer-float-body">
            <div className="timer-float-statusline">
              <span
                className={`timer-status-text timer-status-text--${timer.status}`}
              >
                {statusLabel}
              </span>
              {current && (
                <span className="timer-float-pos">
                  {timer.currentIndex + 1} / {timer.timers.length}
                </span>
              )}
            </div>
            {timer.timers.length > 0 && (
              <ul className="timer-queue">
                {timer.timers.map((tm, i) => {
                  const rowState =
                    i < timer.currentIndex
                      ? "done"
                      : i === timer.currentIndex
                        ? "current"
                        : "upcoming";
                  const modeLabel =
                    tm.mode === "countdown"
                      ? t["timer.countdown"]
                      : t["timer.countup"];
                  const meta =
                    i === timer.currentIndex
                      ? `${modeLabel} ${formatTimer(seconds ?? 0)}`
                      : tm.mode === "countdown"
                        ? `${modeLabel} ${formatTimer(tm.duration)}`
                        : modeLabel;
                  return (
                    <li
                      key={tm.id}
                      className={`timer-queue-row timer-queue-row--${rowState}`}
                    >
                      <span className="timer-queue-state" aria-hidden="true">
                        {rowState === "done"
                          ? "✓"
                          : rowState === "current"
                            ? "▶"
                            : "○"}
                      </span>
                      <span className="timer-queue-name">
                        {tm.name || t["timer.unnamed"]}
                      </span>
                      <span className="timer-queue-meta">{meta}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {isOwner && (
            <div className="timer-float-controls">
              {timer.status === "running" ? (
                <button
                  type="button"
                  className="timer-btn"
                  onClick={onPause}
                  title={t["timer.pause"]}
                >
                  ⏸ {t["timer.pause"]}
                </button>
              ) : timer.status === "paused" ? (
                <button
                  type="button"
                  className="timer-btn timer-btn--primary"
                  onClick={onStart}
                  title={t["timer.resume"]}
                >
                  ▶ {t["timer.resume"]}
                </button>
              ) : (
                <button
                  type="button"
                  className="timer-btn timer-btn--primary"
                  onClick={onStart}
                  disabled={!hasQueue}
                  title={t["timer.start"]}
                >
                  ▶ {t["timer.start"]}
                </button>
              )}
              {(timer.status === "running" || timer.status === "paused") && (
                <button
                  type="button"
                  className="timer-btn"
                  onClick={onNext}
                  disabled={
                    timer.currentIndex < 0 ||
                    timer.currentIndex >= timer.timers.length - 1
                  }
                  title={t["timer.next"]}
                >
                  ⏭ {t["timer.next"]}
                </button>
              )}
              {(timer.status === "running" || timer.status === "paused") && (
                <button
                  type="button"
                  className="timer-btn timer-btn--stop"
                  onClick={onStop}
                  title={t["timer.stop"]}
                >
                  ■ {t["timer.stop"]}
                </button>
              )}
              <button
                type="button"
                className="timer-btn"
                onClick={() => setSetupOpen(true)}
                title={t["timer.setup"]}
              >
                ⚙ {t["timer.setup"]}
              </button>
            </div>
          )}
        </>
      )}

      {setupOpen && isOwner && (
        <TimerSetupDialog
          existing={timer.timers}
          onSubmit={(timers, submitMode) => {
            onSubmit(timers, submitMode);
            setSetupOpen(false);
          }}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </div>
  );
}
