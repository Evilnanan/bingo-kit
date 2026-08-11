import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { RoomSettings } from "../hooks/useRoomSettings";
import { EyeIcon, EyeOffIcon } from "./EyeIcons";
import "./RoomSettingsPanel.css";

interface Props {
  settings: RoomSettings;
  onChange: <K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K],
  ) => void;
  /** Whether the panel should be visible (controls enter/exit animation). */
  open: boolean;
  /** Called to start the close process (triggers exit animation). */
  onClose: () => void;
  /** Called after exit animation completes — parent unmounts the panel. */
  onClosed: () => void;
  /** Ref to the wrapper that contains both the gear button and this panel. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** This player's identity code, masked by default to survive streaming. */
  myCode?: string | null;
  /** Save a new identity code (max 32 chars, any non-empty string). */
  onChangeCode?: (code: string) => void;
}

export function RoomSettingsPanel({
  settings,
  onChange,
  open,
  onClose,
  onClosed,
  anchorRef,
  myCode,
  onChangeCode,
}: Props) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [codeDraft, setCodeDraft] = useState(myCode ?? "");
  const [codeVisible, setCodeVisible] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Keep the draft in sync with the server-authoritative code (initial load,
  // other same-name device changes, ...) by adjusting state during render.
  const [prevMyCode, setPrevMyCode] = useState(myCode ?? "");
  if (prevMyCode !== (myCode ?? "")) {
    setPrevMyCode(myCode ?? "");
    setCodeDraft(myCode ?? "");
  }

  // When parent signals close via open=false, start exit animation.
  // This is a legitimate use of setState-in-effect — we are synchronising
  // internal animation phase with an external prop change.
  useEffect(() => {
    if (!open && !closing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClosing(true);
    }
  }, [open, closing]);

  const handleAnimationEnd = () => {
    if (closing) {
      onClosed();
    }
  };

  // Click-outside closes the panel (with animation)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        anchorRef.current &&
        !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose, anchorRef]);

  const copyCode = () => {
    const code = codeDraft.trim();
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 1500);
      },
      () => {},
    );
  };

  const saveCode = () => {
    const trimmed = codeDraft.trim();
    if (!trimmed || trimmed.length > 32 || trimmed === (myCode ?? "")) return;
    onChangeCode?.(trimmed);
  };

  return (
    <div
      className={`settings-bubble${closing ? " settings-bubble--exit" : ""}`}
      ref={panelRef}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="settings-code">
        <div className="settings-code-head">
          <span className="settings-code-title">{t["settings.codeLabel"]}</span>
          <button
            type="button"
            className="settings-code-btn"
            onClick={copyCode}
            title={t["settings.codeCopy"]}
            aria-label={t["settings.codeCopy"]}
            disabled={!codeDraft.trim()}
          >
            {codeCopied ? t["settings.copied"] : "\u29c9"}
          </button>
        </div>
        <div className="settings-code-edit">
          <span className="settings-code-input-wrap">
            <input
              className="settings-code-input"
              type={codeVisible ? "text" : "password"}
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              placeholder={myCode == null ? "\u2026" : ""}
              maxLength={32}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="settings-code-eye"
              onClick={() => setCodeVisible((v) => !v)}
              title={
                codeVisible ? t["settings.codeHide"] : t["settings.codeShow"]
              }
              aria-label={
                codeVisible ? t["settings.codeHide"] : t["settings.codeShow"]
              }
            >
              {codeVisible ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
          <button
            type="button"
            className="settings-code-save"
            onClick={saveCode}
            disabled={
              !codeDraft.trim() ||
              codeDraft.trim() === (myCode ?? "") ||
              codeDraft.trim().length > 32
            }
          >
            {t["settings.codeSave"]}
          </button>
        </div>
      </div>

      <label className="settings-row">
        <span className="settings-label">{t["settings.hideCounters"]}</span>
        <input
          type="checkbox"
          className="settings-toggle"
          checked={settings.hideCounters}
          onChange={(e) => onChange("hideCounters", e.target.checked)}
        />
      </label>

      <label className="settings-row">
        <span className="settings-label">{t["settings.hideTooltips"]}</span>
        <input
          type="checkbox"
          className="settings-toggle"
          checked={settings.hideTooltips}
          onChange={(e) => onChange("hideTooltips", e.target.checked)}
        />
      </label>

      <label className="settings-row">
        <span className="settings-label">{t["settings.hideStars"]}</span>
        <input
          type="checkbox"
          className="settings-toggle"
          checked={settings.hideStars}
          onChange={(e) => onChange("hideStars", e.target.checked)}
        />
      </label>

      <div className="settings-row">
        <label className="settings-label" htmlFor="settings-font-scale">
          {t["settings.fontScale"]}
        </label>
        <div className="settings-slider-wrap">
          <input
            id="settings-font-scale"
            type="range"
            className="settings-slider"
            min="0.5"
            max="2.0"
            step="0.1"
            value={settings.fontScale}
            onChange={(e) => onChange("fontScale", parseFloat(e.target.value))}
          />
          <span className="settings-slider-value">
            {settings.fontScale.toFixed(1)}×
          </span>
        </div>
      </div>
    </div>
  );
}
