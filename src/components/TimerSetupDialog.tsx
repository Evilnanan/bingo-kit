import { useState } from "react";
import { useT } from "../i18n/useT";
import type { RoomTimer, TimerMode } from "../types";

interface Props {
  /** The queue currently on the server (read-only, shown as context). */
  existing: RoomTimer[];
  onSubmit: (timers: RoomTimer[], submitMode: "append" | "overwrite") => void;
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
 * mode (countdown / count-up) and — for countdowns — a duration. Submitting
 * either appends the rows to the existing queue or overwrites it entirely.
 */
export function TimerSetupDialog({ existing, onSubmit, onClose }: Props) {
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>(() => [
    { id: newId(), name: "", mode: "countdown", minutes: "1", seconds: "0" },
  ]);

  const valid =
    rows.length > 0 &&
    rows.every((r) => {
      if (r.mode === "countup") return true;
      const total = rowSeconds(r);
      return total >= 1 && total <= MAX_TOTAL_SECONDS;
    });

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
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

  const submit = (submitMode: "append" | "overwrite") => {
    if (!valid) return;
    onSubmit(
      rows.map((r) => ({
        id: r.id,
        name: r.name.trim(),
        mode: r.mode,
        duration: r.mode === "countdown" ? rowSeconds(r) : 0,
      })),
      submitMode,
    );
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
                disabled={rows.length <= 1}
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
            className="timer-dialog-btn"
            onClick={addRow}
            disabled={rows.length >= MAX_ROWS}
          >
            {t["timer.add"]}
          </button>
        </div>

        {!valid && (
          <p className="timer-dialog-error" role="alert">
            {t["timer.invalid"]}
          </p>
        )}

        <div className="timer-dialog-footer">
          {existing.length > 0 && (
            <button
              type="button"
              className="timer-dialog-btn timer-dialog-btn--clear"
              onClick={() => onSubmit([], "overwrite")}
              title={t["timer.clearHint"]}
            >
              {t["timer.clear"]}
            </button>
          )}
          <button
            type="button"
            className="timer-dialog-btn timer-dialog-btn--cancel"
            onClick={onClose}
          >
            {t["timer.cancel"]}
          </button>
          <button
            type="button"
            className="timer-dialog-btn"
            onClick={() => submit("append")}
            disabled={!valid}
            title={t["timer.appendHint"]}
          >
            {t["timer.append"]}
          </button>
          <button
            type="button"
            className="timer-dialog-btn"
            onClick={() => submit("overwrite")}
            disabled={!valid}
            title={t["timer.overwriteHint"]}
          >
            {t["timer.overwrite"]}
          </button>
        </div>
      </div>
    </div>
  );
}
