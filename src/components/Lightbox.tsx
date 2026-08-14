import { createPortal } from "react-dom";
import type { ImageAttachment } from "../types";
import { getImageSrc } from "../utils/imageService";
import "./Lightbox.css";

interface Props {
  images: ImageAttachment[];
  /** Index of the image currently shown. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  imageBaseUrl?: string;
}

/**
 * Fullscreen image preview (lightbox).
 * Click the overlay / ✕ / Escape to close; arrow keys switch images; a counter
 * is shown when there is more than one image.
 * Note: the popup is a portal, so React synthetic events still bubble up the
 * component tree (e.g. a cell button's right-click/long-press would star it),
 * so touchstart and contextmenu are intercepted on the overlay.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
  imageBaseUrl,
}: Props) {
  if (index < 0 || index >= images.length) return null;
  const img = images[index];

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      tabIndex={0}
      onTouchStart={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        // The popup is a portal, so React synthetic events still bubble to cell
        // buttons; stopPropagation is required when closing via the overlay,
        // otherwise the click would also toggle a cell mark.
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          // preventDefault cancels the synthetic click that follows, so an
          // overlay tap doesn't toggle a cell mark.
          e.preventDefault();
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        } else if (e.key === "ArrowLeft" && index > 0) {
          onIndexChange(index - 1);
        } else if (e.key === "ArrowRight" && index < images.length - 1) {
          onIndexChange(index + 1);
        }
      }}
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
      >
        ✕
      </button>
      <img
        className="lightbox-img"
        src={getImageSrc(img, imageBaseUrl)}
        alt={img.filename}
        onClick={(e) => e.stopPropagation()}
      />
      {images.length > 1 && (
        <span className="lightbox-counter">
          {index + 1} / {images.length}
        </span>
      )}
    </div>,
    document.body,
  );
}
