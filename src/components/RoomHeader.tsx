import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { GamePhase, PoolMetadata } from "../types";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { RoomSettingsPanel } from "./RoomSettingsPanel";
import { PoolMetadataPanel } from "./PoolMetadataPanel";
import { DEFAULT_SERVER_URL, IMAGE_URL } from "../config";

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
}: Props) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [poolInfoOpen, setPoolInfoOpen] = useState(false);
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
      // Measure the natural layout: no forced wrap.
      right.style.flexBasis = "";
      const t = toolbar.getBoundingClientRect();
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      // "Wrapped" = the right group starts below the left group's row. A
      // second row starts at least the flex gap (12px) lower, while
      // align-items:center offsets same-row tops by only a few px — the
      // bottom + 4px threshold separates the two reliably.
      const wrapped = rightRect.top >= leftRect.bottom + 4;
      if (!wrapped) {
        const controls = [
          ...left.querySelectorAll("button, a, select"),
          ...right.querySelectorAll("button, a, select"),
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
        if (covered) right.style.flexBasis = "100%";
      }
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
          >
            ⚙
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
            !
          </button>
        )}
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
