import type React from "react";
import { TooltipPopover } from "./TooltipPopover";
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
  isLocalMarked: boolean;
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
  isLocalMarked,
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
    isLocalMarked ? "square--local-mark" : "",
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
  }
  const inlineStyle =
    Object.keys(styleObj).length > 0
      ? (styleObj as React.CSSProperties)
      : undefined;

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
      {isSingle && <div className="square-mark-bg" aria-hidden="true" />}

      {/* Multi-color diagonal-split background */}
      {isMulti && (
        <div className="square-segments" aria-hidden="true">
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
                className="square-segment"
                style={{
                  backgroundColor: seg.color,
                  clipPath: `polygon(${topLeft} 0%, ${topRight} 0%, ${bottomRight} 100%, ${bottomLeft} 100%)`,
                }}
              />
            );
          })}
        </div>
      )}

      {counter > 0 && (
        <span
          className="square-counter"
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
      <span className="square-text">{goal}</span>
      {tooltip && <TooltipPopover text={tooltip} />}
    </button>
  );
}
