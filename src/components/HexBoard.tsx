import { useEffect, useRef, useState } from "react";
import type { Team } from "../utils/colors";
import { TEAM_COLORS } from "../utils/colors";
import type { ImageAttachment } from "../types";
import { getGoalImages } from "../types";
import { TooltipPopover } from "./TooltipPopover";
import { useT } from "../i18n/useT";
import type { Player, MarkEntry } from "../types";
import { getGoalCounter, getGoalText, getGoalTooltip } from "../types";
import { useCounters } from "../hooks/useCounters";
import { makeCellEventHandlers, useLongPressAlt } from "../hooks/useLongPress";
import { fitHexText } from "../utils/fitHexText";
import type { HexLine } from "../utils/fitHexText";
import { getSystemFontFamily } from "../utils/measureText";
import type { RoomSettings } from "../hooks/useRoomSettings";
import "./HexBoard.css";
import type { HexConfig } from "../hex/hexTypes";
import { checkWin, indexToAxial } from "../hex/hexUtils";

/** Inert long-press alt used while linking cells (no star toggle). */
const NOOP_ALT = {
  start: () => {},
  cancel: () => {},
  tryAlt: () => {},
  consumed: () => false,
} as const;

interface Props {
  config: HexConfig;
  marks: Record<number, MarkEntry[]>;
  players: Record<string, Player>;
  localPlayerName: string | null;
  onMarkCell: (index: number) => void;
  /** Todo-linking mode: cell clicks pick linked cells instead of marking. */
  linking?: boolean;
  /** Cells currently linked by the todo being edited (highlighted). */
  linkedCells?: Set<number>;
  onLinkCell?: (index: number) => void;
  /** Personal star marks (same-name devices share this). */
  stars: Set<number>;
  /** Personal counter progress (same-name devices share this). */
  counters: Record<number, number>;
  onToggleStar: (index: number, starred: boolean) => void;
  onCounterChange: (index: number, value: number) => void;
  settings: RoomSettings;
  imageBaseUrl?: string;
}

export function HexBoard({
  config,
  marks,
  players,
  localPlayerName,
  onMarkCell,
  linking = false,
  linkedCells,
  onLinkCell,
  stars,
  counters,
  onToggleStar,
  onCounterChange,
  settings,
  imageBaseUrl,
}: Props) {
  const { lang } = useT();
  const { sizeBlue, sizeRed, goals } = config;
  const totalCells = sizeBlue * sizeRed;

  const myTeam: Team | null = (() => {
    if (!localPlayerName) return null;
    const player = players[localPlayerName];
    if (!player) return null;
    return player.color === TEAM_COLORS.red ? "red" : "blue";
  })();

  const redPath: number[] = checkWin(marks, "red", sizeBlue, sizeRed) || [];
  const bluePath: number[] = checkWin(marks, "blue", sizeBlue, sizeRed) || [];
  const redSet = new Set(redPath);
  const blueSet = new Set(bluePath);

  const numCols = sizeBlue + sizeRed - 1;
  const numRows = (sizeBlue + sizeRed) * 0.5;

  const {
    handleClick: rawCounterClick,
    handleContextMenu: rawCounterContextMenu,
    handleTouchStart: rawCounterTouchStart,
    handleTouchEnd: rawCounterTouchEnd,
  } = useCounters(goals, counters, onCounterChange);

  const toggleStarMark = (idx: number) => {
    onToggleStar(idx, !stars.has(idx));
  };

  const starMarkAlt = useLongPressAlt(toggleStarMark);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(() => window.innerWidth);
  const [containerH, setContainerH] = useState(() => window.innerHeight - 200);

  useEffect(() => {
    const el = wrapperRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) {
        setContainerW(entry.contentRect.width);
        setContainerH(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hexW = (() => {
    const maxWidth = containerW;
    const maxHeight = containerH;

    const wDivisor = (numCols - 1) * 0.75 + 1.75;
    const hexWFromWidth = maxWidth / wDivisor;

    const sqrt3o2 = Math.sqrt(3) / 2;
    const hDivisor = sqrt3o2 * (numRows + 0.6) + 0.5;
    const hexWFromHeight = maxHeight / hDivisor;

    const natural = Math.min(hexWFromWidth, hexWFromHeight);
    return Math.floor(Math.min(160, Math.max(24, natural)));
  })();

  const hexH = hexW * (Math.sqrt(3) / 2);
  // Base font size for UI elements (counter, tooltip, star-mark) — NOT scaled.
  const uiFontSize = Math.min(13, Math.max(1, Math.round(hexW * 0.11)));
  // Goal text base font size — 13px, scaled by user-controlled fontScale setting.
  const goalBaseFontSize = Math.round(13 * settings.fontScale);
  const hexPadding = Math.max(2, Math.round(hexW * 0.08));

  const fontFamily = getSystemFontFamily();
  const contentInset = 2; // matches .hex-content { inset: 2px }

  const margin = hexW * 0.25;

  const { boardW, boardH, offsetX, offsetY, blueFill, redFill } = (() => {
    function cellCorner(q: number, r: number) {
      const col = q + r;
      const cx = margin + hexW * col * 0.75 + hexW / 2;
      const minR = Math.max(0, col - (sizeBlue - 1));
      const rowIndex = r - minR;
      const rowOffset = Math.abs(col + 1 - sizeBlue) * 0.5;
      const cy = margin + hexH * (rowIndex + rowOffset) + hexH / 2;
      return { x: cx, y: cy };
    }

    const cTop = cellCorner(sizeBlue - 1, 0);
    const cLeft = cellCorner(0, 0);
    const cBottom = cellCorner(0, sizeRed - 1);
    const cRight = cellCorner(sizeBlue - 1, sizeRed - 1);

    const vTop = { x: cTop.x, y: cTop.y - 0.8 * hexH };
    const vLeft = { x: cLeft.x - 1.2 * hexW, y: cLeft.y };
    const vBottom = { x: cBottom.x, y: cBottom.y + 0.8 * hexH };
    const vRight = { x: cRight.x + 1.2 * hexW, y: cRight.y };

    const cellLeft = margin;
    const cellRight = margin + hexW * (numCols - 1) * 0.75 + hexW;
    const cellTop = margin;
    const cellBottom = margin + hexH * (numRows + 0.5);

    const minX = Math.min(vLeft.x, cellLeft);
    const minY = Math.min(vTop.y, cellTop);
    const maxX = Math.max(vRight.x, cellRight);
    const maxY = Math.max(vBottom.y, cellBottom);

    const ox = margin - minX;
    const oy = margin - minY;

    const bw = maxX - minX + margin;
    const bh = maxY - minY + margin;

    // Build rounded path (CCW: top → left → bottom → right)
    const corners = [vTop, vLeft, vBottom, vRight].map((v) => ({
      x: v.x + ox,
      y: v.y + oy,
    }));
    const n = 4;
    const rTB = margin;
    const rLR = hexW * 0.5;

    // Top/bottom (i=0,2): interior angle 120°, sin(θ/2)=√3/2
    // Left/right  (i=1,3): interior angle 60°,  sin(θ/2)=1/2
    const entry: { x: number; y: number }[] = [];
    const exit: { x: number; y: number }[] = [];
    const arcRs: number[] = [];
    const arcMids: { x: number; y: number }[] = [];

    for (let i = 0; i < n; i++) {
      const p = corners[(i + n - 1) % n];
      const c = corners[i];
      const q = corners[(i + 1) % n];
      const dp = Math.hypot(p.x - c.x, p.y - c.y);
      const dq = Math.hypot(q.x - c.x, q.y - c.y);

      const isTopBottom = i === 0 || i === 2;
      const r = isTopBottom ? rTB : rLR;
      // tan(θ/2): tan(60°)=√3 for top/bottom, tan(30°)=1/√3 for left/right
      const tanHalf = isTopBottom ? Math.sqrt(3) : 1 / Math.sqrt(3);
      // tangent point distance from vertex
      let dt = r / tanHalf;
      dt = Math.min(dt, dp / 2, dq / 2);
      const arcR = dt * tanHalf; // arc radius (≤ r if clamped)

      entry.push({
        x: c.x + (dt / dp) * (p.x - c.x),
        y: c.y + (dt / dp) * (p.y - c.y),
      });
      exit.push({
        x: c.x + (dt / dq) * (q.x - c.x),
        y: c.y + (dt / dq) * (q.y - c.y),
      });
      arcRs.push(arcR);

      // Arc midpoint (on the arc at the angle bisector)
      const bx = (p.x - c.x) / dp + (q.x - c.x) / dq;
      const by = (p.y - c.y) / dp + (q.y - c.y) / dq;
      const bl = Math.hypot(bx, by);
      const sinHalf = isTopBottom ? Math.sqrt(3) / 2 : 0.5;
      const midOff = arcR * (1 / sinHalf - 1);
      arcMids.push({
        x: c.x + (midOff * bx) / bl,
        y: c.y + (midOff * by) / bl,
      });
    }

    // Small quad: corner cell centers (with offset)
    const sTop = { x: cTop.x + ox, y: cTop.y + oy };
    const sLeft = { x: cLeft.x + ox, y: cLeft.y + oy };
    const sBottom = { x: cBottom.x + ox, y: cBottom.y + oy };
    const sRight = { x: cRight.x + ox, y: cRight.y + oy };

    const s = [sTop, sLeft, sBottom, sRight];

    // Each region i covers base edge corners[i]→corners[(i+1)%4]
    // with half of the arc at each end
    function regionPath(i: number) {
      const j = (i + 1) % 4;
      return [
        `M ${s[i].x} ${s[i].y}`,
        `L ${s[j].x} ${s[j].y}`,
        `L ${arcMids[j].x} ${arcMids[j].y}`,
        `A ${arcRs[j]} ${arcRs[j]} 0 0 1 ${entry[j].x} ${entry[j].y}`,
        `L ${exit[i].x} ${exit[i].y}`,
        `A ${arcRs[i]} ${arcRs[i]} 0 0 1 ${arcMids[i].x} ${arcMids[i].y}`,
        "Z",
      ].join(" ");
    }

    // Blue: bottom-left (1) + top-right (3)
    const blueFill = [regionPath(1), regionPath(3)].join(" ");

    // Red: top-left (0) + bottom-right (2)
    const redFill = [regionPath(0), regionPath(2)].join(" ");

    return {
      boardW: bw,
      boardH: bh,
      offsetX: ox,
      offsetY: oy,
      blueFill,
      redFill,
    };
  })();

  const cells = (() => {
    const result: Array<{
      idx: number;
      x: number;
      y: number;
      goal: string;
      tooltip: string | undefined;
      images: ImageAttachment[];
      markTeam: Team | null;
      winTeam: Team | null;
      textLines: HexLine[];
      fontSize: number;
    }> = [];

    for (let idx = 0; idx < totalCells; idx++) {
      const { q, r } = indexToAxial(idx, sizeBlue);
      const col = q + r;
      const x = margin + hexW * col * 0.75;

      const minR = Math.max(0, col - (sizeBlue - 1));
      const rowIndex = r - minR;
      const rowOffset = Math.abs(col + 1 - sizeBlue) * 0.5;
      const y = margin + hexH * (rowIndex + rowOffset);

      const firstEntry = marks[idx]?.[0] ?? null;
      const markTeam: Team | null = firstEntry?.by as Team | null;
      let winTeam: Team | null = null;
      if (redSet.has(idx)) winTeam = "red";
      else if (blueSet.has(idx)) winTeam = "blue";

      const goalItem = goals[idx];
      const goalText = goalItem ? getGoalText(goalItem, lang) : "";
      const { lines, fontSize } = fitHexText(
        goalText,
        goalBaseFontSize,
        hexW,
        hexH,
        contentInset,
        hexPadding,
        fontFamily,
      );
      result.push({
        idx,
        x: x + offsetX,
        y: y + offsetY,
        goal: goalText,
        tooltip: goalItem ? getGoalTooltip(goalItem, lang) : undefined,
        images: goalItem ? getGoalImages(goalItem) : [],
        markTeam,
        winTeam,
        textLines: lines,
        fontSize,
      });
    }

    return result;
  })();

  return (
    <div className="hex-board-wrapper" ref={wrapperRef}>
      <div
        className={`hex-board${linking ? " hex-board--linking" : ""}`}
        style={
          {
            width: boardW,
            height: boardH,
            "--hex-font": `${uiFontSize}px`,
            "--hex-goal-font": `${goalBaseFontSize}px`,
            "--hex-padding": `${hexPadding}px`,
            "--hex-hover-color": myTeam ? TEAM_COLORS[myTeam] : "var(--accent)",
            "--widget-hover": myTeam ? TEAM_COLORS[myTeam] : "var(--accent)",
          } as React.CSSProperties
        }
      >
        <svg
          className="hex-base"
          viewBox={`0 0 ${boardW} ${boardH}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={blueFill} fill="var(--team-blue-fill)" />
          <path d={redFill} fill="var(--team-red-fill)" />
        </svg>
        {cells.map((cell) => {
          let cellClass = "hex";
          if (cell.winTeam) cellClass += ` hex--win hex--${cell.winTeam}-win`;
          else if (cell.markTeam === "red") cellClass += " hex--team-red";
          else if (cell.markTeam === "blue") cellClass += " hex--team-blue";

          return (
            <button
              key={cell.idx}
              type="button"
              className={cellClass}
              style={{
                left: cell.x,
                top: cell.y,
                width: hexW,
                height: hexH,
              }}
              {...(linking
                ? makeCellEventHandlers(
                    NOOP_ALT,
                    onLinkCell ?? (() => {}),
                    cell.idx,
                  )
                : makeCellEventHandlers(starMarkAlt, onMarkCell, cell.idx))}
              onTouchMove={linking ? NOOP_ALT.cancel : starMarkAlt.cancel}
              onTouchCancel={linking ? NOOP_ALT.cancel : starMarkAlt.cancel}
              title={cell.goal}
            >
              <span className="bg" />
              <span className="fill" />
              {linking && (
                <span
                  className={`hex-link-icon${
                    linkedCells?.has(cell.idx) ? " hex-link-icon--linked" : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </span>
              )}
              <span className="content">
                {stars.has(cell.idx) && !settings.hideStars && (
                  <span className="star" />
                )}
                <span
                  className="text"
                  style={
                    cell.fontSize !== goalBaseFontSize
                      ? { fontSize: cell.fontSize }
                      : undefined
                  }
                >
                  {cell.textLines.map((line, i) => (
                    <span
                      key={i}
                      className="text-line"
                      style={{ maxWidth: line.maxWidth }}
                    >
                      {line.text}
                    </span>
                  ))}
                </span>
                {(cell.tooltip || cell.images.length > 0) &&
                  !settings.hideTooltips && (
                    <TooltipPopover
                      text={cell.tooltip}
                      images={cell.images}
                      imageBaseUrl={imageBaseUrl}
                    />
                  )}
              </span>
              {!settings.hideCounters &&
                getGoalCounter(config.goals[cell.idx]) > 0 &&
                linking && (
                  <span className="counter">
                    {counters[cell.idx] ?? 0}/
                    {getGoalCounter(config.goals[cell.idx])}
                  </span>
                )}
              {!settings.hideCounters &&
                getGoalCounter(config.goals[cell.idx]) > 0 &&
                !linking && (
                  <span
                    className="counter"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      rawCounterClick(cell.idx);
                    }}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      rawCounterContextMenu(cell.idx);
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      rawCounterTouchStart(cell.idx);
                    }}
                    onTouchEnd={(e) => {
                      e.stopPropagation();
                      rawCounterTouchEnd();
                    }}
                    onTouchMove={(e) => {
                      e.stopPropagation();
                      rawCounterTouchEnd();
                    }}
                    onTouchCancel={(e) => {
                      e.stopPropagation();
                      rawCounterTouchEnd();
                    }}
                  >
                    {counters[cell.idx] ?? 0}/
                    {getGoalCounter(config.goals[cell.idx])}
                  </span>
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
