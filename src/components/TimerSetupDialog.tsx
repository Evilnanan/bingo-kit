import { useState } from "react";
import { useT } from "../i18n/useT";
import type { RoomTimer, TimerMode } from "../types";

interface Props {
  /** The queue currently on the server (read-only, shown as context). */
  existing: RoomTimer[];
  /** Current auto-start setting on the server — the checkbox starts here
   *  (new queues default to enabled). */
  autoStart: boolean;
  onSubmit: (timers: RoomTimer[], autoStart: boolean) => void;
  onClose: () => void;
}

/** Longest allowed countdown (24 h) — mirrored from the server. */
const MAX_TOTAL_SECONDS = 24 * 60 * 60;
/** UI cap on rows (the server caps the queue at 100). */
const MAX_ROWS = 20;

interface Row {
  id: string;
  name: string;
  mode: TimerMode;
  minutes: string;
  seconds: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowSeconds(row: Row): number {
  const m = Math.min(1439, Math.max(0, parseInt(row.minutes || "0", 10) || 0));
  const s = Math.min(59, Math.max(0, parseInt(row.seconds || "0", 10) || 0));
  return m * 60 + s;
}

/**
 * Owner-only dialog to compose the serial timer queue. Every row is one
 * timer: an optional name/description (so players know what it is for), a
 * mode (countdown / count-up) and — for countdowns — a duration. The dialog
 * opens pre-filled with the current queue (inheriting it), and "Confirm"
 * replaces the queue with what's shown. An auto-start checkbox rides along:
 * when enabled, the queue runs by itself the moment the game starts.
 */
export function TimerSetupDialog({
  existing,
  autoStart: initialAutoStart,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>(() =>
    existing.length > 0
      ? existing.map((t) => ({
          id: t.id,
          name: t.name,
          mode: t.mode,
          minutes:
            t.mode === "countdown" ? String(Math.floor(t.duration / 60)) : "0",
          seconds:
            t.mode === "countdown" ? String(t.duration % 60) : "0",
        }))
      : [
          {
            id: newId(),
            name: "",
            mode: "countdown",
            minutes: "1",
            seconds: "0",
          },
        ],
  );
  const [autoStart, setAutoStart] = useState(initialAutoStart);

  const valid =
  // Empty is a valid state: confirming it clears the queue.
  rows.length === 0 ||
  rows.every((r) => {
    if (r.mode === "countup") return true;
    const total = rowSeconds(r);
    return total >= 1 && total <= MAX_TOTAL_SECONDS;
  });

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // The last row may be removed too — the list may end up empty.
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const addRow = () => {
    setRows((prev) =>
      prev.length >= MAX_ROWS
        ? prev
        : [
            ...prev,
            { id: newId(), name: "", mode: "countdown", minutes: "1", seconds: "0" },
          ],
    );
  };

  const submit = () => {
    if (!valid) return;
    onSubmit(
      rows.map((r) => ({
        id: r.id,
        name: r.name.trim(),
        mode: r.mode,
        duration: r.mode === "countdown" ? rowSeconds(r) : 0,
      })),
      autoStart,
    );
  };

  /** Clear the draft rows shown in this dialog. Nothing is submitted — the
   *  cleared list only reaches the server when the owner confirms, so they
   *  can freely rebuild the queue before that. */
  const clearAll = () => {
    setRows([]);
  };

  return (
    <div className="timer-dialog-overlay">
      <div className="timer-dialog" role="dialog" aria-modal="true">
        <h2 className="timer-dialog-title">{t["timer.setupTitle"]}</h2>

        <div className="timer-dialog-rows">
          {rows.map((row, i) => (
            <div className="timer-dialog-row" key={row.id}>
              <span className="timer-dialog-index">{i + 1}</span>
              <input
                className="timer-dialog-name"
                type="text"
                value={row.name}
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
                placeholder={t["timer.namePlaceholder"]}
                maxLength={100}
                spellCheck={false}
              />
              <select
                className="timer-dialog-mode"
                value={row.mode}
                onChange={(e) =>
                  updateRow(row.id, { mode: e.target.value as TimerMode })
                }
                aria-label={t["timer.mode"]}
              >
                <option value="countdown">{t["timer.countdown"]}</option>
                <option value="countup">{t["timer.countup"]}</option>
              </select>
              {row.mode === "countdown" ? (
                <span className="timer-dialog-duration">
                  <input
                    className="timer-dialog-num"
                    type="number"
                    min={0}
                    max={1439}
                    value={row.minutes}
                    onChange={(e) =>
                      updateRow(row.id, { minutes: e.target.value })
                    }
                    aria-label={t["timer.minutes"]}
                  />
                  <span className="timer-dialog-unit">{t["timer.minutes"]}</span>
                  <input
                    className="timer-dialog-num"
                    type="number"
                    min={0}
                    max={59}
                    value={row.seconds}
                    onChange={(e) =>
                      updateRow(row.id, { seconds: e.target.value })
                    }
                    aria-label={t["timer.seconds"]}
                  />
                  <span className="timer-dialog-unit">{t["timer.seconds"]}</span>
                </span>
              ) : (
                <span className="timer-dialog-hint">{t["timer.countupHint"]}</span>
              )}
              <button
                type="button"
                className="timer-dialog-remove"
                onClick={() => removeRow(row.id)}
                title={t["timer.remove"]}
                aria-label={t["timer.remove"]}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="timer-dialog-actions">
          <button
            type="button"
            className="timer-dialog-add"
            onClick={addRow}
            disabled={rows.length >= MAX_ROWS}
          >
            {t["timer.add"]}
          </button>
        </div>

        <label className="timer-dialog-autostart">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
          />
          {t["timer.autoStart"]}
        </label>

        {!valid && (
          <p className="timer-dialog-error" role="alert">
            {t["timer.invalid"]}
          </p>
        )}

        <div className="timer-dialog-footer">
          <button
            type="button"
            className="timer-dialog-btn timer-dialog-btn--clear"
            onClick={clearAll}
            disabled={rows.length === 0}
            title={t["timer.clearHint"]}
          >
            {t["timer.clear"]}
          </button>
          <button
            type="button"
            className="timer-dialog-btn timer-dialog-btn--cancel"
            onClick={onClose}
          >
            {t["timer.cancel"]}
          </button>
          <button
            type="button"
            className="timer-dialog-btn timer-dialog-btn--primary"
            onClick={submit}
            disabled={!valid}
          >
            {t["timer.confirm"]}
          </button>
        </div>
      </div>
    </div>
  );
}
