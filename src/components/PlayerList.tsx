import { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { Player } from "../types";
import type { ScoreMap, ScoringRule } from "../scoring/types";
import { PLAYER_COLORS } from "../utils/colors";
import { useT, format } from "../i18n/useT";
import { ScoringRuleCard } from "./ScoringRuleCard";
import "./PlayerList.css";

type SortMode = "join" | "name" | "score";

interface Props {
  players: Player[];
  scores?: ScoreMap;
  bonusScores?: Record<string, number>;
  localPlayerName: string | null;
  onChangeColor: (color: string) => void;
  onChangeName: (newName: string) => void;
  onSetBonusScore?: (playerName: string, bonus: number) => void;
  allowedColors?: string[];
  showScoringRule?: boolean;
  rule?: ScoringRule | null | undefined;
}

export function PlayerList({
  players,
  scores,
  bonusScores,
  localPlayerName,
  onChangeColor,
  onChangeName,
  onSetBonusScore,
  allowedColors,
  showScoringRule,
  rule,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("join");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingBonus, setEditingBonus] = useState<string | null>(null);
  const [bonusInput, setBonusInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bonusInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { t } = useT();

  // Collapse the player list so the chat/notes panel gets more vertical space.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("bingo-player-list-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("bingo-player-list-collapsed", next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  };

  const hasScores = scores != null;
  const canEditBonus = onSetBonusScore != null;

  const handlePick = (color: string) => {
    onChangeColor(color);
    setPickerOpen(false);
  };

  const startEditing = () => {
    setNameInput(localPlayerName || "");
    setEditingName(true);
    setPickerOpen(false);
  };

  const commitEdit = () => {
    const trimmed = nameInput.trim();
    if (trimmed && trimmed !== localPlayerName) {
      onChangeName(trimmed);
    }
    setEditingName(false);
  };

  const cancelEdit = () => {
    setEditingName(false);
  };

  useEffect(() => {
    if (editingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingName]);

  useEffect(() => {
    if (editingBonus && bonusInputRef.current) {
      bonusInputRef.current.focus();
      bonusInputRef.current.select();
    }
  }, [editingBonus]);

  const startBonusEdit = (playerName: string) => {
    if (!canEditBonus) return;
    const current = bonusScores?.[playerName] ?? 0;
    setBonusInput(String(current));
    setEditingBonus(playerName);
  };

  const commitBonusEdit = () => {
    if (editingBonus && canEditBonus) {
      const parsed = Number(bonusInput.trim());
      if (!isNaN(parsed)) {
        onSetBonusScore(editingBonus, parsed);
      }
    }
    setEditingBonus(null);
  };

  const cancelBonusEdit = () => {
    setEditingBonus(null);
  };

  const myPlayer = players.find((p) => p.name === localPlayerName);

  // Remember join order (position in the original players array).
  const joinIndex = new Map<string, number>();
  players.forEach((p, i) => joinIndex.set(p.name, i));

  // Track previous render's sort order for stable tie-breaking:
  // when scores are equal, preserve the relative order from last frame.
  const prevOrderRef = useRef<string[]>([]);

  // Sort players (React Compiler auto-memoizes).
  const list = [...players];
  // eslint-disable-next-line react-hooks/refs
  list.sort((a, b) => {
    let cmp: number;
    switch (sortMode) {
      case "score": {
        const sa = (scores?.[a.color] ?? 0) + (bonusScores?.[a.name] ?? 0);
        const sb = (scores?.[b.color] ?? 0) + (bonusScores?.[b.name] ?? 0);
        cmp = sa - sb;
        break;
      }
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "join":
      default:
        cmp = (joinIndex.get(a.name) ?? 0) - (joinIndex.get(b.name) ?? 0);
        break;
    }
    if (cmp === 0) {
      // Tie: preserve the relative order from the previous render.
      // This must NOT be negated by sortAsc, otherwise descending
      // score sort would reverse the stable tie order too.
      const prev = prevOrderRef.current;
      const ai = prev.indexOf(a.name);
      const bi = prev.indexOf(b.name);
      if (ai >= 0 && bi >= 0) return ai - bi;
      return (joinIndex.get(a.name) ?? 0) - (joinIndex.get(b.name) ?? 0);
    }
    return sortAsc ? cmp : -cmp;
  });
  const sortedPlayers = list;

  // Remember this frame's order for next tie-break.
  // eslint-disable-next-line react-hooks/refs
  prevOrderRef.current = sortedPlayers.map((p) => p.name);

  // ---- FLIP animation ----
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  // Track the last committed order so we can skip no-op re-renders
  // (e.g. the optimistic-update + server-echo double-render).
  const lastOrderRef = useRef<string>("");

  // Stable key from current sort order (React Compiler auto-memoizes).
  const orderKey = sortedPlayers.map((p) => p.name).join(",");

  useLayoutEffect(() => {
    if (!listRef.current) return;

    // Bail out if the order didn't actually change — this prevents
    // the server-echo render from canceling an in-progress FLIP
    // animation that the optimistic-update render just started.
    if (orderKey === lastOrderRef.current) return;
    lastOrderRef.current = orderKey;

    const items =
      listRef.current.querySelectorAll<HTMLLIElement>(".player-item");

    // 1. Cancel running animations & reset transforms so we read true
    //    layout positions.
    for (const item of items) {
      item.getAnimations().forEach((a) => a.cancel());
      item.style.transform = "";
    }
    void listRef.current.offsetHeight; // force reflow

    // 2. Read current layout positions.
    const currentRects = new Map<string, DOMRect>();
    for (const item of items) {
      const name = item.dataset.playerName;
      if (name) currentRects.set(name, item.getBoundingClientRect());
    }

    // 3. Animate from previous → current.
    if (prevRects.current.size > 0) {
      for (const item of items) {
        const name = item.dataset.playerName;
        if (!name) continue;
        const prev = prevRects.current.get(name);
        const curr = currentRects.get(name);
        if (!prev || !curr) continue;

        const dx = prev.left - curr.left;
        const dy = prev.top - curr.top;

        if (dx !== 0 || dy !== 0) {
          item.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            {
              duration: 300,
              easing: "cubic-bezier(0.25, 0.8, 0.25, 1.2)",
            },
          );
        }
      }
    }

    // 4. Remember current layout positions for the next cycle.
    prevRects.current = currentRects;
  }, [sortedPlayers, orderKey]);

  const toggleSort = (mode: SortMode) => {
    if (sortMode === mode) {
      setSortAsc((v) => !v);
    } else {
      setSortMode(mode);
      setSortAsc(mode === "score" ? false : true); // score defaults desc
    }
  };

  function renderScore(p: Player): React.ReactNode {
    const ruleScore = scores?.[p.color];
    if (ruleScore == null)
      return <span className="player-score">{t["players.noScore"]}</span>;

    const bonus = bonusScores?.[p.name] ?? 0;
    const total = ruleScore + bonus;

    if (editingBonus === p.name) {
      return (
        <span className="player-score">
          <span className="player-score-rule">{ruleScore}</span>
          <span className="player-score-op">{bonus >= 0 ? "+" : "−"}</span>
          <input
            ref={bonusInputRef}
            className="player-bonus-input"
            value={bonusInput}
            onChange={(e) => setBonusInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitBonusEdit();
              if (e.key === "Escape") cancelBonusEdit();
            }}
            onBlur={commitBonusEdit}
            size={3}
          />
          <span className="player-score-total">
            = {format(t["players.score"], total)}
          </span>
        </span>
      );
    }

    if (bonus === 0) {
      return (
        <span
          className={`player-score${canEditBonus ? " player-score--editable" : ""}`}
          title={canEditBonus ? t["players.editBonus"] : undefined}
          onClick={canEditBonus ? () => startBonusEdit(p.name) : undefined}
        >
          {format(t["players.score"], total)}
        </span>
      );
    }

    const op = bonus > 0 ? "+" : "−";
    const absBonus = Math.abs(bonus);
    return (
      <span
        className={`player-score${canEditBonus ? " player-score--editable" : ""}`}
        title={canEditBonus ? t["players.editBonus"] : undefined}
        onClick={canEditBonus ? () => startBonusEdit(p.name) : undefined}
      >
        <span className="player-score-rule">{ruleScore}</span>
        <span className="player-score-op"> {op} </span>
        <span className="player-score-bonus">{absBonus}</span>
        <span className="player-score-total">
          {" "}
          = {format(t["players.score"], total)}
        </span>
      </span>
    );
  }

  return (
    <div className={`player-list${collapsed ? " player-list--collapsed" : ""}`}>
      <div className="player-list-header">
        <button
          type="button"
          className="player-list-title-row"
          onClick={toggleCollapsed}
          title={collapsed ? t["players.expand"] : t["players.collapse"]}
          aria-expanded={!collapsed}
        >
          <h3 className="player-list-title">
            {format(t["players.title"], players.length)}
          </h3>
        </button>
        {!collapsed && hasScores && (
          <div className="player-list-sort">
            <span className="sort-label">{t["scoring.sortBy"]}</span>
            <button
              type="button"
              className={`sort-btn${sortMode === "score" ? " sort-btn--active" : ""}`}
              onClick={() => toggleSort("score")}
            >
              {t["scoring.sortScore"]}
              {sortMode === "score" && (sortAsc ? " ↑" : " ↓")}
            </button>
            <button
              type="button"
              className={`sort-btn${sortMode === "name" ? " sort-btn--active" : ""}`}
              onClick={() => toggleSort("name")}
            >
              {t["scoring.sortName"]}
              {sortMode === "name" && (sortAsc ? " ↑" : " ↓")}
            </button>
            <button
              type="button"
              className={`sort-btn${sortMode === "join" ? " sort-btn--active" : ""}`}
              onClick={() => toggleSort("join")}
            >
              {t["scoring.sortJoin"]}
              {sortMode === "join" && (sortAsc ? " ↑" : " ↓")}
            </button>
          </div>
        )}
      </div>
      {players.length === 0 && (
        <p className="player-list-empty">{t["players.waiting"]}</p>
      )}
      <ul className="player-list-items" ref={listRef}>
        {sortedPlayers.map((p) => {
          return (
            <li
              key={p.name}
              className={`player-item${p.name === localPlayerName ? " player-item--me" : ""}`}
              data-player-name={p.name}
            >
              <button
                type="button"
                className={`player-dot${p.name === localPlayerName ? " player-dot--editable" : ""}`}
                style={{ backgroundColor: p.color }}
                title={
                  p.name === localPlayerName ? t["players.changeColor"] : p.name
                }
                onClick={
                  p.name === localPlayerName
                    ? () => setPickerOpen((v) => !v)
                    : undefined
                }
              />
              {editingName && p.name === localPlayerName ? (
                <input
                  ref={inputRef}
                  className="player-name-input"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  onBlur={commitEdit}
                  maxLength={30}
                />
              ) : (
                <span
                  className={`player-name${p.name === localPlayerName ? " player-name--editable" : ""}`}
                  title={
                    p.name === localPlayerName
                      ? t["players.editName"]
                      : undefined
                  }
                  onClick={
                    p.name === localPlayerName ? startEditing : undefined
                  }
                >
                  {p.name}
                </span>
              )}
              {renderScore(p)}
            </li>
          );
        })}
      </ul>

      {pickerOpen && myPlayer && (
        <div className="color-picker">
          {(allowedColors ?? PLAYER_COLORS).map((c) => (
            <button
              key={c}
              type="button"
              className={`color-picker-swatch${c === myPlayer.color ? " color-picker-swatch--active" : ""}`}
              style={{ backgroundColor: c }}
              onClick={() => handlePick(c)}
              title={c}
            />
          ))}
        </div>
      )}
      {showScoringRule && <ScoringRuleCard rule={rule} />}
    </div>
  );
}
