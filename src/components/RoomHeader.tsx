import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/useT";
import type { GamePhase, PoolMetadata } from "../types";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { RoomSettingsPanel } from "./RoomSettingsPanel";
import { PoolMetadataPanel } from "./PoolMetadataPanel";
import { SettingsIcon, InfoIcon } from "./icons";
import { DEFAULT_SERVER_URL, IMAGE_URL } from "../config";
import "./TimerPanel.css";

interface Props {
  roomName: string;
  serverUrl: string;
  onLeave: () => void;
  extraParams?: Record<string, string>;
  isOwner?: boolean;
  phase?: GamePhase;
  onRestart?: () => void;
  metadata?: PoolMetadata | null;
  imageBaseUrl: string;
  settings: RoomSettings;
  onSettingsChange: <K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K],
  ) => void;
  /** This player's identity code, shown (masked) inside the settings panel. */
  myCode?: string | null;
  /** Persist a new identity code entered in the settings panel. */
  onChangeCode?: (code: string) => void;
  /**
   * Minimized room-timer chip, rendered at the end of the header's right
   * group. When the toolbar-avoidance logic forces the right group onto its
   * own row, the chip moves to the first row, right of the leave button.
   */
  headerTimer?: ReactNode;
}

export function RoomHeader({
  roomName,
  serverUrl,
  onLeave,
  extraParams,
  isOwner,
  phase,
  onRestart,
  metadata,
  imageBaseUrl,
  settings,
  onSettingsChange,
  myCode,
  onChangeCode,
  headerTimer,
}: Props) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [poolInfoOpen, setPoolInfoOpen] = useState(false);
  // True while the toolbar-avoidance forces the right group to its own row:
  // the minimized timer chip then lives in the first row instead.
  const [timerInLeft, setTimerInLeft] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // The fixed app toolbar covers the top-right corner of the viewport, so a
  // first-row control that reaches that corner becomes unclickable. The
  // header's content is left-packed, so padding/margins cannot shift it out
  // from under the toolbar — the only reliable escape is to move the right
  // group onto its own second row, which sits below the toolbar and uses
  // the full width. The decision is made from the *natural* layout (no
  // forced wrap) so it depends only on content + viewport and can't
  // oscillate:
  //
  //  - Right group already wrapped, or nothing under the toolbar: leave it.
  //  - Not wrapped + a control under the toolbar: force the right group to
  //    its own full-width row (flex-basis: 100%).
  //
  // Timing matters: header content can change without the header's box
  // size changing (e.g. the pool-info button appearing when the server
  // state arrives after joining — on mobile that round-trip takes long
  // enough to outlive the mount-time measurement). ResizeObserver on the
  // header can't see such changes, so the measurement re-runs on every
  // React commit instead, plus resize/scroll/visualViewport/fonts events
  // for layout changes that don't go through React (URL-bar collapse on
  // mobile, etc.). No ResizeObserver is used, so our own flex-basis writes
  // can't feed back into a re-measure loop.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let raf = 0;
    let disposed = false;
    const update = () => {
      raf = 0;
      const toolbar = document.querySelector<HTMLElement>(".app-toolbar");
      const left = header.querySelector<HTMLElement>(".room-header-left");
      const right = header.querySelector<HTMLElement>(".room-header-right");
      if (!toolbar || !left || !right) return;
      // Width of the real chip, measured from the live DOM before the
      // placement-mode hide/show below. The twin's measurement footprint is
      // pinned to this exact width (see the twin block below), so the
      // natural-layout wrap/coverage checks see precisely the mode-invariant
      // "chip in the right group" layout in both placement modes and the
      // decision can't depend on which group currently holds the visible
      // chip. The real chip is always a <button>; the twin is a <span>, so
      // "button.timer-header-chip" can never match the twin.
      const realChip = header.querySelector<HTMLElement>(
        "button.timer-header-chip",
      );
      const chipWidth = realChip ? realChip.getBoundingClientRect().width : 76;
      // Measure the natural layout: no forced wrap.
      right.style.flexBasis = "";
      // The decision must not depend on which group currently holds the
      // visible chip, or the chip moving between groups would flip the
      // measurement and oscillate. Always measure the true "chip in the right
      // group" layout: when the chip sits in the left group, temporarily hide
      // it so the natural wrap/coverage checks match the right-group
      // placement. (The hidden twin in the right group keeps that group's
      // width identical to the real chip's in both modes.) The hide is
      // reverted synchronously before paint, so no flash or gap appears.
      const chipInLeft = left.querySelector<HTMLElement>(
        "button.timer-header-chip",
      );
      const prevDisplay = chipInLeft ? chipInLeft.style.display : null;
      if (chipInLeft) chipInLeft.style.display = "none";
      // The measurement twin normally takes no space (display: none) so the
      // painted second row isn't squeezed by invisible width. While measuring,
      // give it the real chip's footprint — the wrap/coverage checks below
      // must match the "chip in the right group" layout. The twin's width is
      // pinned to the real chip's measured width: left unpinned, the
      // "88:88:88" text would size it at 76-84px even when the real chip is
      // the idle 32px square, and that phantom width would flip the measured
      // layout into "wrapped" at intermediate viewport widths — skipping the
      // toolbar avoidance entirely while the painted first row (twin hidden,
      // chip in the left group) still fits and reaches under the toolbar.
      // (min-width: 76px from .timer-header-chip must be cleared too.) The
      // hide and the twin's footprint are reverted synchronously before
      // paint, so no flash appears.
      const twin = right.querySelector<HTMLElement>(".timer-header-measure");
      const prevTwinDisplay = twin ? twin.style.display : null;
      const prevTwinWidth = twin ? twin.style.width : null;
      const prevTwinMinWidth = twin ? twin.style.minWidth : null;
      if (twin) {
        twin.style.width = `${chipWidth}px`;
        twin.style.minWidth = "0";
        twin.style.display = "inline-flex";
      }
      const t = toolbar.getBoundingClientRect();
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      // "Wrapped" = the right group starts below the left group's row. A
      // second row starts at least the flex gap (12px) lower, while
      // align-items:center offsets same-row tops by only a few px — the
      // bottom + 4px threshold separates the two reliably.
      const wrapped = rightRect.top >= leftRect.bottom + 4;
      let avoid = false;
      if (!wrapped) {
        const controls = [
          ...left.querySelectorAll("button, a, select"),
          ...right.querySelectorAll("button, a, select"),
          // The hidden layout twin of the minimized timer chip: it occupies
          // the chip's position in the right group, so the coverage check is
          // the same whether the visible chip sits there or in the first row.
          ...right.querySelectorAll(".timer-header-measure"),
        ] as HTMLElement[];
        const covered = controls.some((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.right > t.left &&
            r.left < t.right &&
            r.bottom > t.top &&
            r.top < t.bottom
          );
        });
        if (covered) {
          right.style.flexBasis = "100%";
          avoid = true;
        }
      }
      if (chipInLeft) chipInLeft.style.display = prevDisplay ?? "";
      // The minimized chip belongs on the first row, right of the leave
      // button, whenever the right group can't stay there — whether it wraps
      // naturally at narrow widths or is forced down to avoid the toolbar.
      // Only exception: at extreme widths the chip itself would land under
      // the toolbar there (e.g. the restart button widens the first row), so
      // it stays with the right group instead. All values are from the
      // mode-invariant measurement above, so the decision can't oscillate.
      let chipToLeft = false;
      if (headerTimer !== undefined && (wrapped || avoid)) {
        const gap = parseFloat(getComputedStyle(header).gap) || 12;
        // Position the hypothetical chip right after the left group; chipWidth
        // is the real chip's width captured above (mode-invariant), not the
        // twin's, so both placement modes reach the same decision.
        const chipLeft = leftRect.right + gap;
        const chipRight = chipLeft + chipWidth;
        const chipCovered = chipLeft < t.right && chipRight > t.left;
        chipToLeft = !chipCovered;
      }
      // Drop the twin's temporary measurement footprint (back to display:
      // none via CSS, unpinned width) before the browser paints this frame.
      if (twin) {
        twin.style.display = prevTwinDisplay ?? "";
        twin.style.width = prevTwinWidth ?? "";
        twin.style.minWidth = prevTwinMinWidth ?? "";
      }
      setTimerInLeft(chipToLeft);
    };
    const schedule = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(update);
    };
    update();
    // Re-measure on every commit: catches header content that arrives
    // asynchronously (server state after joining, phase changes, ...).
    // Also listen for layout changes that don't re-render React: mobile
    // URL-bar collapse fires resize/scroll/visualViewport, and font swaps
    // change text widths.
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts?.ready.then(() => schedule()).catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  const openPanel = () => {
    setPanelMounted(true);
    setSettingsOpen(true);
  };

  const closePanel = () => setSettingsOpen(false);
  const removePanel = () => setPanelMounted(false);

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomName);
    // Only include server/images when they differ from the defaults, so links
    // shared with the default server/image stay clean. Delete first to avoid
    // carrying over stale params from the current URL.
    url.searchParams.delete("server");
    url.searchParams.delete("images");
    if (serverUrl !== DEFAULT_SERVER_URL) {
      url.searchParams.set("server", serverUrl);
    }
    const defaultImageBaseUrl = IMAGE_URL || DEFAULT_SERVER_URL;
    if (imageBaseUrl !== defaultImageBaseUrl) {
      url.searchParams.set("images", imageBaseUrl);
    }
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v);
      }
    }
    url.searchParams.set("share", "1");
    navigator.clipboard.writeText(url.toString()).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  const handleRestart = () => {
    if (!restartConfirm) {
      setRestartConfirm(true);
      setTimeout(() => setRestartConfirm(false), 3000);
      return;
    }
    setRestartConfirm(false);
    onRestart?.();
  };

  const showRestart = phase === "playing" && isOwner;

  return (
    <header className="room-header" ref={headerRef}>
      <div className="room-header-left">
        <button
          type="button"
          className="room-back"
          onClick={onLeave}
          title={t["room.leaveTitle"]}
        >
          {t["room.leave"]}
        </button>
        {showRestart && (
          <button
            type="button"
            className={`room-restart${restartConfirm ? " room-restart--confirm" : ""}`}
            onClick={handleRestart}
          >
            {restartConfirm ? t["room.restartConfirm"] : t["room.restart"]}
          </button>
        )}
        {headerTimer && timerInLeft && headerTimer}
      </div>
      <div className="room-header-right">
        <span className="room-name-label">
          {t["room.room"]} <strong>{roomName}</strong>
        </span>
        <button
          type="button"
          className={`room-copy-link${copied ? " room-copy-link--copied" : ""}`}
          onClick={handleCopyLink}
        >
          {copied ? t["room.copied"] : t["room.copyLink"]}
        </button>
        <div className="room-settings-wrap" ref={settingsWrapRef}>
          <button
            type="button"
            className="room-settings-btn"
            onClick={() => (settingsOpen ? closePanel() : openPanel())}
            title={t["settings.title"]}
            aria-label={t["settings.title"]}
          >
            <SettingsIcon />
          </button>
          {panelMounted && (
            <RoomSettingsPanel
              settings={settings}
              onChange={onSettingsChange}
              open={settingsOpen}
              onClose={closePanel}
              onClosed={removePanel}
              anchorRef={settingsWrapRef}
              myCode={myCode}
              onChangeCode={onChangeCode}
            />
          )}
        </div>
        {metadata && (
          <button
            type="button"
            className="room-pool-info-btn"
            onClick={() => setPoolInfoOpen((v) => !v)}
            title={t["tooltip.info"]}
            aria-label={t["tooltip.info"]}
          >
            <InfoIcon />
          </button>
        )}
        {headerTimer &&
          (timerInLeft ? (
            // Hidden layout twin: keeps the avoidance measurement stable
            // while the visible chip sits in the left group. "88:88:88" is
            // the widest time the chip can show (tabular-nums), so the twin
            // always matches or exceeds the real chip's width.
            <span
              className="timer-header-chip timer-header-measure"
              aria-hidden="true"
            >
              88:88:88
            </span>
          ) : (
            headerTimer
          ))}
      </div>
      {poolInfoOpen && metadata && (
        <PoolMetadataPanel
          metadata={metadata}
          imageBaseUrl={imageBaseUrl}
          onClose={() => setPoolInfoOpen(false)}
        />
      )}
    </header>
  );
}
