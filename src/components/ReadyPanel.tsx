import { useState, useEffect } from "react";
import type { Player, GamePhase } from "../types";
import { useT } from "../i18n/useT";
import "./ReadyPanel.css";

interface Props {
  connecting: boolean;
  players: Player[];
  localPlayerName: string | null;
  phase: GamePhase;
  countdownSeconds: number | null;
  onToggleReady: () => void;
  onChangeColor: (color: string) => void;
  onChangeName: (newName: string) => void;
}

export function ReadyPanel({
  connecting,
  players,
  localPlayerName,
  phase,
  countdownSeconds,
  onToggleReady,
}: Props) {
  const { t } = useT();
  // Tick counter — interval only increments this, no sync setState in effect body
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (phase !== "countdown" || countdownSeconds == null) return;

    // Reset tick on a deferred frame — avoids sync setState in effect body.
    const resetFrame = requestAnimationFrame(() => setTick(0));
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => {
      cancelAnimationFrame(resetFrame);
      clearInterval(id);
    };
  }, [phase, countdownSeconds]);

  // Derived value — React Compiler memoizes this automatically
  const remaining =
    phase !== "countdown" || countdownSeconds == null
      ? 0
      : Math.max(0, countdownSeconds - Math.floor(tick / 10));

  const showCountdown = phase === "countdown" && countdownSeconds != null;

  const myPlayer = players.find((p) => p.name === localPlayerName);

  if (connecting) {
    return (
      <div className="ready-panel">
        <div className="ready-connecting-spinner" aria-hidden="true" />
        <p className="ready-connecting-text">{t["lobby.connecting"]}</p>
      </div>
    );
  }

  if (showCountdown) {
    return (
      <div className="ready-panel ready-panel--countdown">
        <div className="ready-countdown-number">{remaining}</div>
        <p className="ready-countdown-text">{t["lobby.countdown"]}</p>
      </div>
    );
  }

  return (
    <div className="ready-panel">
      <h2 className="ready-panel-title">{t["lobby.title"]}</h2>

      <ul className="ready-player-list">
        {players.map((p) => {
          const isMe = p.name === localPlayerName;
          const isReady = p.ready === true;
          return (
            <li
              key={p.name}
              className={`ready-player-item${isMe ? " ready-player-item--me" : ""}${isReady ? " ready-player-item--ready" : ""}`}
            >
              <span
                className="ready-player-dot"
                style={{ backgroundColor: p.color }}
              />
              <span className="ready-player-name">{p.name}</span>
              <span
                className={`ready-status${isReady ? " ready-status--on" : " ready-status--off"}`}
              >
                {isReady ? "✔" : "○"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="ready-actions">
        {myPlayer && (
          <button
            type="button"
            className={`ready-toggle-btn${myPlayer.ready ? " ready-toggle-btn--ready" : ""}`}
            onClick={onToggleReady}
          >
            {myPlayer.ready ? t["lobby.notReady"] : t["lobby.ready"]}
          </button>
        )}
      </div>
    </div>
  );
}
