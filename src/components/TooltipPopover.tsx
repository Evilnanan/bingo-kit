import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { ImageAttachment } from "../types";
import { getImageSrc } from "../utils/imageService";
import { Lightbox } from "./Lightbox";
import "./TooltipPopover.css";

interface Props {
  text?: string;
  images?: ImageAttachment[];
  imageBaseUrl?: string;
}

export function TooltipPopover({ text, images, imageBaseUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(-1);
  // Set of image hashes that finished loading (including failures — failed
  // images are hidden and their spinner stops).
  const [loadedImages, setLoadedImages] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { t } = useT();

  const hasContent = Boolean(text) || (images && images.length > 0);

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
    setLightboxIdx(-1);
  };

  // The popup is a portal, so React synthetic events still bubble to cell
  // buttons (a cell's onContextMenu / long-press would star it) — intercept
  // them here.
  const stopContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      {hasContent && (
        <span
          className="tooltip"
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
      )}
      {open &&
        createPortal(
          <div
            className="tooltip-overlay"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onTouchStart={handleTouchStart}
            onContextMenu={stopContext}
            onClick={handleClose}
            onTouchEnd={handleClose}
          >
            <div
              className="tooltip-popup"
              onTouchStart={handleTouchStart}
              onContextMenu={stopContext}
              onClick={(e) => e.stopPropagation()}
              onTouchEnd={(e) => {
                // Can't preventDefault here: it would cancel the child image
                // button's synthetic click.
                e.stopPropagation();
              }}
            >
              {text && <p className="tooltip-popup-text">{text}</p>}
              {images && images.length > 0 && (
                <div
                  className={`tooltip-popup-images${text ? "" : " tooltip-popup-images--no-text"}`}
                >
                  {images.map((att, i) => (
                    <button
                      key={att.hash}
                      type="button"
                      className="tooltip-popup-img-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxIdx(i);
                      }}
                      title={att.filename}
                    >
                      {/* Show a spinner until the image has loaded */}
                      {!loadedImages.has(att.hash) && (
                        <span
                          className="tooltip-popup-img-spinner"
                          aria-hidden="true"
                        />
                      )}
                      <img
                        className={`tooltip-popup-img${loadedImages.has(att.hash) ? " tooltip-popup-img--loaded" : ""}`}
                        src={getImageSrc(att, imageBaseUrl)}
                        alt={att.filename}
                        loading="lazy"
                        onLoad={() => {
                          setLoadedImages((prev) =>
                            new Set(prev).add(att.hash),
                          );
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          // Mark failures as finished too, so the spinner
                          // stops (the image itself is already hidden).
                          setLoadedImages((prev) =>
                            new Set(prev).add(att.hash),
                          );
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
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

      {/* Lightbox */}
      {lightboxIdx >= 0 && images && images.length > 0 && (
        <Lightbox
          images={images}
          index={lightboxIdx}
          onIndexChange={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
          imageBaseUrl={imageBaseUrl}
        />
      )}
    </>
  );
}
