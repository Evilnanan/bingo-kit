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

  // 弹窗是 portal，React 合成事件仍会沿组件树冒泡到格子按钮
  // （格子的 onContextMenu / 长按会触发星标），必须在此拦截。
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
                // 不能 preventDefault：会取消子元素（图片按钮）的合成 click
                e.stopPropagation();
              }}
            >
              {text && <p className="tooltip-popup-text">{text}</p>}
              {images && images.length > 0 && (
                <div className={`tooltip-popup-images${text ? "" : " tooltip-popup-images--no-text"}`}>
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
                      <img
                        className="tooltip-popup-img"
                        src={getImageSrc(att, imageBaseUrl)}
                        alt={att.filename}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
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
