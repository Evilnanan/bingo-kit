import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import type { RoomSettings } from "../hooks/useRoomSettings";
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
}

export function RoomSettingsPanel({
  settings,
  onChange,
  open,
  onClose,
  onClosed,
  anchorRef,
}: Props) {
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

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

  return (
    <div
      className={`settings-bubble${closing ? " settings-bubble--exit" : ""}`}
      ref={panelRef}
      onAnimationEnd={handleAnimationEnd}
    >
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
