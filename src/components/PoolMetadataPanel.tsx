import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT";
import type { PoolMetadata } from "../types";
import { getPoolDescription, getPoolName } from "../types";
import { getImageSrc } from "../utils/imageService";
import { Lightbox } from "./Lightbox";
import "./PoolMetadataPanel.css";

interface Props {
  metadata: PoolMetadata;
  imageBaseUrl?: string;
  onClose: () => void;
}

/**
 * Room-side modal showing the goal pool metadata (name / description /
 * images) that the room owner attached when creating the room.
 */
export function PoolMetadataPanel({ metadata, imageBaseUrl, onClose }: Props) {
  const { t, lang } = useT();
  const [lightboxIdx, setLightboxIdx] = useState(-1);
  // 已加载完成的图片 hash 集合（含加载失败，失败后图片隐藏、spinner 停止）
  const [loadedImages, setLoadedImages] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const images = metadata.images ?? [];

  return createPortal(
    <>
      <div className="pool-meta-overlay" onClick={onClose}>
        <div
          className="pool-meta-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pool-meta-title"
        >
          <div className="pool-meta-header">
            <h2 className="pool-meta-title" id="pool-meta-title">
              {getPoolName(metadata, lang)}
            </h2>
            <button
              type="button"
              className="pool-meta-close"
              onClick={onClose}
              title={t["tooltip.close"]}
            >
              ✕
            </button>
          </div>
          <div className="pool-meta-scroll">
            <p className="pool-meta-desc">
              {getPoolDescription(metadata, lang) ||
                t["poolMeta.noDescription"]}
            </p>
            {images.length > 0 && (
              <div className="pool-meta-images">
                {images.map((att, i) => (
                  <button
                    key={att.hash}
                    type="button"
                    className="pool-meta-img-btn"
                    onClick={() => setLightboxIdx(i)}
                    title={att.filename}
                  >
                    {/* 图片未加载完成时显示 spinner */}
                    {!loadedImages.has(att.hash) && (
                      <span
                        className="pool-meta-img-spinner"
                        aria-hidden="true"
                      />
                    )}
                    <img
                      className={`pool-meta-img${loadedImages.has(att.hash) ? " pool-meta-img--loaded" : ""}`}
                      src={getImageSrc(att, imageBaseUrl)}
                      alt={att.filename}
                      loading="lazy"
                      onLoad={() => {
                        setLoadedImages((prev) => new Set(prev).add(att.hash));
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        // 失败也标记为已结束，停止 spinner（图片本身已隐藏）
                        setLoadedImages((prev) => new Set(prev).add(att.hash));
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {lightboxIdx >= 0 && images.length > 0 && (
        <Lightbox
          images={images}
          index={lightboxIdx}
          onIndexChange={setLightboxIdx}
          onClose={() => setLightboxIdx(-1)}
          imageBaseUrl={imageBaseUrl}
        />
      )}
    </>,
    document.body,
  );
}
