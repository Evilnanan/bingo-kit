import { useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { GamePhase } from "../types";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { RoomSettingsPanel } from "./RoomSettingsPanel";

interface Props {
  roomName: string;
  serverUrl: string;
  onLeave: () => void;
  extraParams?: Record<string, string>;
  isOwner?: boolean;
  phase?: GamePhase;
  onRestart?: () => void;
  settings: RoomSettings;
  onSettingsChange: <K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K],
  ) => void;
}

export function RoomHeader({
  roomName,
  serverUrl,
  onLeave,
  extraParams,
  isOwner,
  phase,
  onRestart,
  settings,
  onSettingsChange,
}: Props) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    setPanelMounted(true);
    setSettingsOpen(true);
  };

  const closePanel = () => setSettingsOpen(false);
  const removePanel = () => setPanelMounted(false);

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomName);
    url.searchParams.set("server", serverUrl);
    url.searchParams.set("share", "1");
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v);
      }
    }
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
    <header className="room-header">
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
            />
          )}
        </div>
      </div>
    </header>
  );
}
