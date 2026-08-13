import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";

export interface VirtualListOptions {
  /** Estimated row height used until a row is measured. */
  estimate?: number;
  /** Vertical gap between rows; must match the row wrapper's margin-bottom. */
  gap?: number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  /**
   * Re-run viewport measurement and scroll restore when this changes. Pass a
   * value that changes whenever the scroll container is unmounted/remounted
   * (e.g. an editor mode), so a remounted container's DOM scrollTop (0) is
   * reconciled with the saved scroll position.
   */
  remountKey?: unknown;
}

export interface VirtualListResult {
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  registerRowEl: (el: HTMLDivElement | null) => void | (() => void);
  resetScroll: () => void;
  virtualStart: number;
  virtualEnd: number;
  spacerTop: number;
  spacerBottom: number;
}

/**
 * Windowing for lists with variable-height rows. Only rows near the viewport
 * are mounted; spacers preserve the full scroll extent. Row heights are
 * tracked with ResizeObserver so offsets stay correct as content changes
 * (resized textareas, expanded panels, etc.).
 *
 * Each rendered row wrapper must set `data-row-index={virtualStart + i}` and
 * use `ref={registerRowEl}` so the hook can associate it with a slot.
 */
export function useVirtualList(
  count: number,
  options: VirtualListOptions = {},
): VirtualListResult {
  const { estimate = 190, gap = 8, overscan = 5, remountKey } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeights, setRowHeights] = useState<Map<number, number>>(
    () => new Map(),
  );
  const rowElsRef = useRef<Set<HTMLDivElement>>(new Set());
  const rowObserverByElRef = useRef<Map<HTMLDivElement, ResizeObserver>>(
    new Map(),
  );
  const rowLastIdxByElRef = useRef<Map<HTMLDivElement, number>>(new Map());
  const latestScrollTopRef = useRef(0);
  const scrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  // Mirror the scroll position so it survives the container being
  // unmounted/remounted (e.g. switching editor tabs).
  useEffect(() => {
    scrollTopRef.current = scrollTop;
  }, [scrollTop]);

  // Measure the list viewport and restore the saved scroll position when the
  // container mounts (or remounts, per remountKey).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop !== scrollTopRef.current) {
      el.scrollTop = scrollTopRef.current;
    }
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [remountKey]);

  const resetScroll = useCallback(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, []);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    latestScrollTopRef.current = e.currentTarget.scrollTop;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollTop(latestScrollTopRef.current);
    });
  }, []);

  const registerRowEl = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    rowElsRef.current.add(el);
    return () => {
      rowElsRef.current.delete(el);
    };
  }, []);

  // Reconcile row measurement after every commit: attach observers to newly
  // mounted rows, disconnect observers for unmounted rows, and re-measure
  // rows whose visible index changed (e.g. while filtering).
  useLayoutEffect(() => {
    const mounted = rowElsRef.current;
    const measure = (el: HTMLDivElement, idx: number) => {
      const h = Math.round(el.getBoundingClientRect().height);
      setRowHeights((prev) => {
        if (prev.get(idx) === h) return prev;
        const next = new Map(prev);
        next.set(idx, h);
        return next;
      });
    };
    for (const el of mounted) {
      const idx = Number(el.dataset.rowIndex);
      const lastIdx = rowLastIdxByElRef.current.get(el);
      if (lastIdx !== idx) {
        rowLastIdxByElRef.current.set(el, idx);
        measure(el, idx);
      }
      if (rowObserverByElRef.current.has(el)) continue;
      const update = () => measure(el, Number(el.dataset.rowIndex));
      update();
      const ro = new ResizeObserver(update);
      rowObserverByElRef.current.set(el, ro);
      ro.observe(el);
    }
    for (const [el, ro] of rowObserverByElRef.current) {
      if (!mounted.has(el)) {
        ro.disconnect();
        rowObserverByElRef.current.delete(el);
        rowLastIdxByElRef.current.delete(el);
      }
    }
  });

  // Compute which rows to mount and the spacer heights that preserve the
  // full scroll extent. Offsets account for measured heights, falling back to
  // an estimate until a row is measured.
  const { virtualStart, virtualEnd, spacerTop, spacerBottom } = useMemo(() => {
    const n = count;
    if (n === 0) {
      return { virtualStart: 0, virtualEnd: 0, spacerTop: 0, spacerBottom: 0 };
    }
    const offsets: number[] = new Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      offsets[i] = acc;
      acc += (rowHeights.get(i) ?? estimate) + gap;
    }
    offsets[n] = acc;

    const viewportBottom = scrollTop + Math.max(viewportHeight, 100);
    // First row whose bottom edge is at or below scrollTop.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    const firstVisible = lo;
    // First row whose top edge is below the viewport bottom.
    lo = 0;
    hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= viewportBottom) lo = mid + 1;
      else hi = mid;
    }
    const afterLast = lo;

    const virtualStart = Math.max(0, firstVisible - overscan);
    const virtualEnd = Math.min(n, afterLast + overscan);
    return {
      virtualStart,
      virtualEnd,
      spacerTop: offsets[virtualStart],
      spacerBottom: offsets[n] - offsets[virtualEnd],
    };
  }, [count, scrollTop, viewportHeight, rowHeights, estimate, gap, overscan]);

  return {
    containerRef,
    onScroll,
    registerRowEl,
    resetScroll,
    virtualStart,
    virtualEnd,
    spacerTop,
    spacerBottom,
  };
}
