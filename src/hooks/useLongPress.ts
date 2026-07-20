import { useRef } from "react";

/**
 * Shared long-press / right-click alternate action handler.
 * Desktop: right-click fires altAction.
 * Mobile: touch-hold (500ms) fires altAction, with click suppression to prevent double-fire.
 */
export function useLongPressAlt(altAction: (idx: number) => void, delay = 350) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const start = (idx: number) => {
    firedRef.current = false;
    idxRef.current = idx;
    timerRef.current = setTimeout(() => {
      if (idxRef.current === idx) {
        firedRef.current = true;
        altAction(idx);
      }
      timerRef.current = null;
    }, delay);
  };

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    idxRef.current = null;
  };

  const tryAlt = (idx: number) => {
    if (firedRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      firedRef.current = true;
    }
    altAction(idx);
  };

  const consumed = () => {
    if (firedRef.current) {
      firedRef.current = false;
      return true;
    }
    return false;
  };

  return { start, cancel, tryAlt, consumed } as const;
}

/** Standard cell event wiring for long-press alternate action. */
export function makeCellEventHandlers(
  alt: ReturnType<typeof useLongPressAlt>,
  onAction: (idx: number) => void,
  idx: number,
) {
  return {
    onClick: () => {
      if (!alt.consumed()) onAction(idx);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      alt.tryAlt(idx);
    },
    onTouchStart: () => alt.start(idx),
    onTouchEnd: alt.cancel,
  };
}
