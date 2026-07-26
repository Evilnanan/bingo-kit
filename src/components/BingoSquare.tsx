import { useEffect, useRef, useState } from "react";
import type React from "react";
import { TooltipPopover } from "./TooltipPopover";
import { fitSquareText } from "../utils/fitSquareText";
import { getSystemFontFamily } from "../utils/measureText";
import "./BingoSquare.css";

export interface ColorSegment {
  /** Hex color string, e.g. "#2563eb" */
  color: string;
  /** Diagonal coordinate width (sum of all segments = 1.5). Segments ordered left-to-right by mark timestamp. */
  width: number;
}

interface CounterHandlers {
  onClick: () => void;
  onContextMenu: () => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
}

interface Props {
  goal: string;
  tooltip?: string;
  difficulty?: number;
  /** Color segments ordered by mark timestamp (left → right). Empty = no marks. */
  colorSegments: ColorSegment[];
  /** Border color for marked cells (highest-scoring player's color). */
  borderColor?: string;
  /** The local player's color, used as the hover border color. */
  hoverColor?: string;
  isStarMarked: boolean;
  counter: number;
  counterValue: number;
  counterHandlers: CounterHandlers;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
}

export function BingoSquare({
  goal,
  tooltip,
  difficulty,
  colorSegments,
  borderColor,
  hoverColor,
  isStarMarked,
  counter,
  counterValue,
  counterHandlers,
  onClick,
  onContextMenu,
  onTouchStart,
  onTouchEnd,
}: Props) {
  const hasMarks = colorSegments.length > 0;
  const isSingle = colorSegments.length === 1;
  const isMulti = colorSegments.length >= 2;

  const classNames = [
    "square",
    hasMarks ? "square--marked" : "",
    isSingle ? "square--single-mark" : "",
    isMulti ? "square--multi-mark" : "",
    difficulty && difficulty >= 2 ? `square--diff-${difficulty}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Inline styles: border color + hover border color
  const styleObj: Record<string, string> = {};
  if (borderColor) {
    styleObj["--mark-border"] = borderColor;
  }
  if (hoverColor) {
    styleObj["--hover-border"] = hoverColor;
    styleObj["--widget-hover"] = hoverColor;
  }
  const inlineStyle =
    Object.keys(styleObj).length > 0
      ? (styleObj as React.CSSProperties)
      : undefined;

  // ---- Adaptive font sizing via ResizeObserver ----
  const squareRef = useRef<HTMLButtonElement>(null);
  const [contentW, setContentW] = useState(0);
  const [contentH, setContentH] = useState(0);

  useEffect(() => {
    const el = squareRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) {
        setContentW(entry.contentRect.width);
        setContentH(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Read --cell-font-scale CSS custom property (for OBS custom CSS injection).
  // OBS users can set e.g. `:root { --cell-font-scale: 1.3; }` to make text 30% larger.
  const [fontScale, setFontScale] = useState(1);
  useEffect(() => {
    const el = squareRef.current;
    if (!el) return;
    const raw = getComputedStyle(el)
      .getPropertyValue("--cell-font-scale")
      .trim();
    const scale = parseFloat(raw);
    if (scale && !isNaN(scale) && scale > 0) {
      setFontScale(scale);
    }
  }, []);

  const fontFamily = getSystemFontFamily();

  const optimalFontSize = (() => {
    // Before ResizeObserver fires — use sensible default
    if (!contentW || !contentH) {
      return Math.round(13 * fontScale);
    }
    // Base font size 13px — binary search in fitSquareText handles the rest
    const baseFontSize = Math.round(13 * fontScale);
    return fitSquareText(goal, baseFontSize, contentW, contentH, fontFamily);
  })();

  // Pre-compute cumulative positions in diagonal coordinate system.
  // Segment i spans from cum[i] to cum[i+1]; cum[N] = 1.5 (natural right boundary).
  // A dividing line at position f goes from (f*100%, 0) to ((f-0.5)*100%, 100%).
  // The c=1.5 diagonal hits the cell's bottom-right corner exactly.
  const cum: number[] = [0];
  for (let i = 0; i < colorSegments.length; i++) {
    cum.push(cum[i] + colorSegments[i].width);
  }

  return (
    <button
      ref={squareRef}
      type="button"
      className={classNames}
      style={inlineStyle}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Single-marker solid background */}
      {isSingle && <div className="mark-bg" aria-hidden="true" />}

      {/* Multi-color diagonal-split background */}
      {isMulti && (
        <div className="segments" aria-hidden="true">
          {colorSegments.map((seg, i) => {
            const left = cum[i];
            const right = cum[i + 1];
            const isFirst = i === 0;

            // Left edge for the first segment uses the cell boundary (straight);
            // all other edges are diagonals with slope H/(W/2).
            const topLeft = `${(left * 100).toFixed(1)}%`;
            const topRight = `${(right * 100).toFixed(1)}%`;
            const bottomRight = `${((right - 0.5) * 100).toFixed(1)}%`;
            const bottomLeft = isFirst
              ? "0%"
              : `${((left - 0.5) * 100).toFixed(1)}%`;

            return (
              <div
                key={i}
                className="segment"
                style={{
                  backgroundColor: seg.color,
                  clipPath: `polygon(${topLeft} 0%, ${topRight} 0%, ${bottomRight} 100%, ${bottomLeft} 100%)`,
                }}
              />
            );
          })}
        </div>
      )}

      {isStarMarked && <span className="star" />}

      {counter > 0 && (
        <span
          className="counter"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            counterHandlers.onClick();
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            e.preventDefault();
            counterHandlers.onContextMenu();
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            counterHandlers.onTouchStart();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            counterHandlers.onTouchEnd();
          }}
          onTouchMove={(e) => {
            e.stopPropagation();
            counterHandlers.onTouchEnd();
          }}
          onTouchCancel={(e) => {
            e.stopPropagation();
            counterHandlers.onTouchEnd();
          }}
        >
          {counterValue}/{counter}
        </span>
      )}
      <span className="text" style={{ fontSize: optimalFontSize }}>
        {goal}
      </span>
      {tooltip && <TooltipPopover text={tooltip} />}
    </button>
  );
}
