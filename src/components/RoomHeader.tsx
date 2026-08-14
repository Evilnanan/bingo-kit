import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { GamePhase, PoolMetadata } from "../types";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { RoomSettingsPanel } from "./RoomSettingsPanel";
import { PoolMetadataPanel } from "./PoolMetadataPanel";
import { DEFAULT_SERVER_URL, IMAGE_URL } from "../config";

/**
 * Horizontal space reserved for the floating app toolbar (fixed top-right,
 * ~164px wide incl. margin). Only applied while a first-row control would
 * sit under it — see the layout effect below.
 */
const TOOLBAR_CLEARANCE_PX = 176;

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
  // first-row control that reaches that corner becomes unclickable. Reserve
  // the toolbar's width only while that would happen; once the header wraps,
  // the later rows sit below the toolbar and must use the full width. The
  // check always measures the unpadded layout, so the decision depends only
  // on content + viewport and can't oscillate with the padding itself.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const toolbar = document.querySelector<HTMLElement>(".app-toolbar");
      const left = header.querySelector<HTMLElement>(".room-header-left");
      const right = header.querySelector<HTMLElement>(".room-header-right");
      if (!toolbar || !left || !right) return;
      const prevPad = header.style.paddingRight;
      header.style.paddingRight = "0px";
      const t = toolbar.getBoundingClientRect();
      // "Wrapped" = the right group starts below the left group's row. A
      // second row starts at least the flex gap (12px) lower, while
      // align-items:center offsets same-row tops by only a few px — the
      // bottom + 4px threshold separates the two reliably.
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const wrapped = rightRect.top >= leftRect.bottom + 4;
      const controls = [
        ...left.querySelectorAll("button, a, select"),
        ...right.querySelectorAll("button, a, select"),
      ] as HTMLElement[];
      const covered =
        !wrapped &&
        controls.some((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.right > t.left &&
            r.left < t.right &&
            r.bottom > t.top &&
            r.top < t.bottom
          );
        });
      header.style.paddingRight = prevPad;
      header.style.paddingRight = covered ? `${TOOLBAR_CLEARANCE_PX}px` : "0px";
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    const ro = new ResizeObserver(schedule);
    ro.observe(header);
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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
