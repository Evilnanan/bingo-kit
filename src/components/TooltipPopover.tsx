import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import "./TooltipPopover.css";

interface Props {
  text: string;
}

export function TooltipPopover({ text }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useT();

  const handleToggle = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen((v) => !v);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  const handleClose = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(false);
  };

  return (
    <>
      <span
        className="tooltip-trigger"
        role="button"
        tabIndex={0}
        onTouchStart={handleTouchStart}
        onClick={handleToggle}
        onTouchEnd={handleToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        title={t["tooltip.info"]}
        aria-label={t["tooltip.info"]}
      >
        !
      </span>
      {open &&
        createPortal(
          <div
            className="tooltip-overlay"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onTouchStart={handleTouchStart}
            onClick={handleClose}
            onTouchEnd={handleClose}
          >
            <div
              className="tooltip-popup"
              onTouchStart={handleTouchStart}
              onClick={(e) => e.stopPropagation()}
              onTouchEnd={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <p className="tooltip-popup-text">{text}</p>
              <button
                type="button"
                className="tooltip-popup-close"
                onTouchStart={handleTouchStart}
                onClick={handleClose}
                onTouchEnd={handleClose}
              >
                {t["tooltip.close"]}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
