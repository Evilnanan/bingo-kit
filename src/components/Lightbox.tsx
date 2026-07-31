import { createPortal } from "react-dom";
import type { ImageAttachment } from "../types";
import { getImageSrc } from "../utils/imageService";
import "./Lightbox.css";

interface Props {
  images: ImageAttachment[];
  /** 当前显示的图片索引 */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  imageBaseUrl?: string;
}

/**
 * 全屏图片预览（lightbox）。
 * 点遮罩 / ✕ / Escape 关闭；左右方向键切换图片；多于一张时显示计数器。
 * 注意：弹窗是 portal，React 合成事件仍会沿组件树冒泡（如格子按钮的
 * 右键/长按会触发星标），因此在遮罩上统一拦截 touchstart 和 contextmenu。
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
      onClick={onClose}
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
