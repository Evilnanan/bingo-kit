import { useRef, useState, useEffect, useSyncExternalStore } from "react";
import { useT, format } from "../i18n/useT";
import type {
  GoalItem,
  GoalPool,
  ImageAttachment,
  PoolMetadata,
} from "../types";
import { savePools } from "../utils/goalPoolStorage";
import {
  mergeDataIntoAttachments,
  mergeDataIntoGoals,
} from "../utils/imageDataStore";
import {
  parsePoolJson,
  poolToDocument,
  sanitizeFilename,
} from "../utils/poolJson";
import {
  fileToImageAttachment,
  getImageSrc,
  type ImageUploadQueue,
  type UploadStatusInfo,
} from "../utils/imageService";
import { Lightbox } from "./Lightbox";
import "./GoalPoolManager.css";

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return "xxxx-xxxx-xxxx-xxxx".replace(/x/g, () =>
    ((Math.random() * 16) | 0).toString(16),
  );
}

interface Props {
  pools: GoalPool[];
  currentPoolId: string;
  defaultGoals: GoalItem[];
  uploadQueue?: ImageUploadQueue | null;
  onSelect: (poolId: string) => void;
  onUpdate: (pools: GoalPool[]) => void;
  onClose: () => void;
}

const EMPTY_STATUS_MAP = new Map<string, UploadStatusInfo>();

function PoolMetaEditor({
  pool,
  uploadQueue,
  onSave,
  onClose,
}: {
  pool: GoalPool;
  uploadQueue: ImageUploadQueue | null;
  onSave: (
    name: string,
    description: string,
    images: ImageAttachment[],
  ) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState(pool.name);
  const [description, setDescription] = useState(pool.description ?? "");
  const [images, setImages] = useState<ImageAttachment[]>(pool.images ?? []);
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [renamingHash, setRenamingHash] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const mouseDownOnOverlay = useRef(false);

  // Upload statuses — subscribe to the queue as an external store.
  const allStatuses = useSyncExternalStore(
    uploadQueue ? (cb) => uploadQueue.onStatusChange(cb) : () => () => {},
    () => uploadQueue?.getSnapshot() ?? EMPTY_STATUS_MAP,
  );

  const handleAddImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newAtts = [...images];
    for (const file of files) {
      try {
        const att = await fileToImageAttachment(file);
        // Dedup by hash
        if (newAtts.some((a) => a.hash === att.hash)) continue;
        newAtts.push(att);
        // Upload in background
        if (uploadQueue) uploadQueue.enqueue(att);
      } catch (err) {
        if (err instanceof Error) alert(err.message);
      }
    }
    setImages(newAtts);
    e.target.value = "";
  };

  const handleRemoveImage = (hash: string) => {
    setImages((current) => current.filter((a) => a.hash !== hash));
  };

  const handleRetryImage = (att: ImageAttachment) => {
    if (uploadQueue) {
      uploadQueue.retry(att.hash);
      uploadQueue.enqueue(att);
    }
  };

  const handleStartRename = (att: ImageAttachment, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingHash(att.hash);
    setRenameText(att.filename);
  };

  const handleCommitRename = (hash: string) => {
    const trimmed = renameText.trim();
    if (trimmed && trimmed !== images.find((a) => a.hash === hash)?.filename) {
      setImages((current) =>
        current.map((a) => (a.hash === hash ? { ...a, filename: trimmed } : a)),
      );
    }
    setRenamingHash(null);
    setRenameText("");
  };

  const handleRenameKeyDown = (hash: string, e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommitRename(hash);
    } else if (e.key === "Escape") {
      setRenamingHash(null);
      setRenameText("");
    }
  };

  // 关闭窗口默认保存；只有点击取消才不保存。
  const handleCloseAndSave = () => {
    onSave(name, description, images);
    onClose();
  };

  return (
    <div
      className="gp-overlay"
      onMouseDown={(e) => {
        mouseDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (mouseDownOnOverlay.current) handleCloseAndSave();
      }}
    >
      <div
        className="gp-modal gp-meta-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gp-header">
          <h2 className="gp-title">{t["goalPool.editInfo"]}</h2>
          <button
            type="button"
            className="gp-close"
            onClick={handleCloseAndSave}
          >
            ✕
          </button>
        </div>

        <div className="gp-modal-scroll">
          <label className="gp-meta-field">
            <span className="gp-meta-label">{t["goalPool.name"]}</span>
            <input
              className="gp-meta-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t["goalPool.namePlaceholder"]}
              autoFocus
            />
          </label>

          <label className="gp-meta-field">
            <span className="gp-meta-label">{t["goalPool.description"]}</span>
            <textarea
              className="gp-meta-input gp-meta-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t["goalPool.descriptionPlaceholder"]}
              rows={4}
            />
          </label>

          <div className="gp-meta-field">
            <span className="gp-meta-label">
              {t["goalPool.images"]}
              {images.length > 0 && (
                <span className="gp-meta-count">({images.length})</span>
              )}
            </span>
            <div className="gp-meta-images">
              {images.map((att) => {
                const status = allStatuses.get(att.hash);
                const isError = status?.status === "error";
                const isUploading = status?.status === "uploading" || !status;
                return (
                  <div key={att.hash} className="gp-meta-image-thumb">
                    <div
                      className={`gp-meta-image-frame${isError ? " gp-meta-image-frame--error" : ""}`}
                      title={
                        isError
                          ? `${t["editor.imageFailed"]}: ${status?.error ?? ""}`
                          : att.filename
                      }
                      role="button"
                      tabIndex={0}
                      onClick={() => setPreviewIdx(images.indexOf(att))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPreviewIdx(images.indexOf(att));
                        }
                      }}
                    >
                      <img
                        className="gp-meta-image-preview"
                        src={getImageSrc(att)}
                        alt={att.filename}
                      />
                      {isUploading ? (
                        <span className="gp-meta-image-status gp-meta-image-status--spinner" />
                      ) : isError ? (
                        <button
                          type="button"
                          className="gp-meta-image-status gp-meta-image-status--retry"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetryImage(att);
                          }}
                          title={t["editor.imageFailed"]}
                        >
                          ↻
                        </button>
                      ) : (
                        <span className="gp-meta-image-status gp-meta-image-status--done">
                          ✓
                        </span>
                      )}
                      <button
                        type="button"
                        className="gp-meta-image-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveImage(att.hash);
                        }}
                        title={t["editor.imageRemove"]}
                      >
                        ×
                      </button>
                    </div>
                    {renamingHash === att.hash ? (
                      <input
                        className="gp-meta-image-rename-input"
                        type="text"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onBlur={() => handleCommitRename(att.hash)}
                        onKeyDown={(e) => handleRenameKeyDown(att.hash, e)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                      />
                    ) : (
                      <span
                        className="gp-meta-image-name"
                        onClick={(e) => handleStartRename(att, e)}
                        title={`${att.filename} — ${t["editor.imageRenameHint"]}`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            e.preventDefault();
                            setRenamingHash(att.hash);
                            setRenameText(att.filename);
                          }
                        }}
                      >
                        {att.filename}
                      </span>
                    )}
                  </div>
                );
              })}
              <label className="gp-meta-image-add">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    void handleAddImages(e);
                  }}
                  className="gp-meta-image-input"
                />
                + {t["editor.addImages"]}
              </label>
            </div>
          </div>
        </div>

        <div className="gp-footer gp-meta-footer">
          <button type="button" className="gp-btn" onClick={onClose}>
            {t["goalPool.cancel"]}
          </button>
        </div>
      </div>

      {previewIdx >= 0 && (
        <Lightbox
          images={images}
          index={previewIdx}
          onIndexChange={setPreviewIdx}
          onClose={() => setPreviewIdx(-1)}
        />
      )}
    </div>
  );
}

export function GoalPoolManager({
  pools,
  currentPoolId,
  defaultGoals,
  uploadQueue,
  onSelect,
  onUpdate,
  onClose,
}: Props) {
  const { t } = useT();
  const mouseDownOnOverlay = useRef(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [editingMetaId, setEditingMetaId] = useState<string | null>(null);
  const [importError, setImportError] = useState("");

  // Auto-reset confirm-delete state after 3 seconds
  useEffect(() => {
    if (!confirmingDeleteId) return;
    const timer = setTimeout(() => setConfirmingDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDeleteId]);

  const handleCreate = () => {
    // Generate a default numbered name like "任务池 1", "任务池 2"...
    let n = pools.length + 1;
    const base = t["goalPool.newDefaultName"];
    let name = `${base} ${n}`;
    while (pools.some((p) => p.name === name)) {
      n++;
      name = `${base} ${n}`;
    }
    const now = Date.now();
    const newPool: GoalPool = {
      id: generateId(),
      name,
      goals: [],
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...pools, newPool];
    savePools(updated);
    onUpdate(updated);
    // Open the info editor immediately so the user can name the new pool
    setEditingMetaId(newPool.id);
  };

  const handleDelete = (pool: GoalPool) => {
    setConfirmingDeleteId(null);
    let updated = pools.filter((p) => p.id !== pool.id);
    // If deleting the last pool, create the "示例" pool with default goals
    if (updated.length === 0) {
      const now = Date.now();
      const defaultPool: GoalPool = {
        id: generateId(),
        name: t["goalPool.defaultName"],
        goals: [...defaultGoals],
        createdAt: now,
        updatedAt: now,
      };
      updated = [defaultPool];
    }
    savePools(updated);
    onUpdate(updated);
    // If current pool was deleted, select the first available
    if (pool.id === currentPoolId) {
      onSelect(updated[0].id);
    }
  };

  const handleExportPool = async (pool: GoalPool) => {
    // 导出前从 IndexedDB 补全图片 base64 data（localStorage 只存元数据），
    // 保证导出的 JSON 携带完整图片数据（R2 图片只有 30 天生命周期）。
    const exportGoals = await mergeDataIntoGoals(pool.goals);
    const exportImages = await mergeDataIntoAttachments(pool.images);
    const meta: PoolMetadata = {
      name: pool.name,
      ...(pool.description ? { description: pool.description } : {}),
      ...(exportImages && exportImages.length > 0
        ? { images: exportImages }
        : {}),
    };
    const json = JSON.stringify(poolToDocument(meta, exportGoals), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(pool.name)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const result = parsePoolJson(parsed, t, format, (msg) =>
          setImportError(msg),
        );
        if (!result) return;
        const now = Date.now();
        const meta = result.metadata;
        const baseName = meta?.name?.trim() || t["goalPool.importedName"];
        // 保证池名不与其他池重复
        let name = baseName;
        let n = 2;
        while (pools.some((p) => p.name === name)) {
          name = `${baseName} ${n}`;
          n++;
        }
        const newPool: GoalPool = {
          id: generateId(),
          name,
          goals: result.goals,
          ...(meta?.description?.trim()
            ? { description: meta.description.trim() }
            : {}),
          ...(meta?.images && meta.images.length > 0
            ? { images: meta.images }
            : {}),
          createdAt: now,
          updatedAt: now,
        };
        const updated = [...pools, newPool];
        savePools(updated);
        onUpdate(updated);
      } catch (err) {
        setImportError(
          `${t["editor.importJsonFailed"]}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const editingMetaPool = pools.find((p) => p.id === editingMetaId) ?? null;

  const handleSaveMeta = (
    name: string,
    description: string,
    images: ImageAttachment[],
  ) => {
    if (!editingMetaId) return;
    const pool = pools.find((p) => p.id === editingMetaId);
    if (!pool) return;
    const trimmedName = name.trim() || pool.name;
    const trimmedDesc = description.trim();
    const updated = pools.map((p) => {
      if (p.id !== editingMetaId) return p;
      const next: GoalPool = {
        ...p,
        name: trimmedName,
        updatedAt: Date.now(),
      };
      if (trimmedDesc) next.description = trimmedDesc;
      else delete next.description;
      if (images.length > 0) next.images = images;
      else delete next.images;
      return next;
    });
    savePools(updated);
    onUpdate(updated);
    setEditingMetaId(null);
  };

  return (
    <div
      className="gp-overlay"
      onMouseDown={(e) => {
        mouseDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (mouseDownOnOverlay.current) onClose();
      }}
    >
      <div className="gp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gp-header">
          <h2 className="gp-title">{t["goalPool.manager"]}</h2>
          <button type="button" className="gp-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="gp-modal-scroll">
          {pools.length === 0 && (
            <p className="gp-empty">{t["editor.empty"]}</p>
          )}

          <div className="gp-list">
            {pools.map((pool) => (
              <div
                key={pool.id}
                className={`gp-item${pool.id === currentPoolId ? " gp-item--active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(pool.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(pool.id);
                  }
                }}
              >
                <div className="gp-item-info">
                  <span className="gp-item-name">{pool.name}</span>
                  <span className="gp-item-count">
                    {format(t["goalPool.goalCount"], pool.goals.length)}
                  </span>
                </div>
                <div className="gp-item-actions">
                  <button
                    type="button"
                    className="gp-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleExportPool(pool);
                    }}
                    title={t["editor.exportJson"]}
                  >
                    {t["editor.exportJson"]}
                  </button>
                  <button
                    type="button"
                    className="gp-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingMetaId(pool.id);
                    }}
                  >
                    {t["goalPool.info"]}
                  </button>
                  <button
                    type="button"
                    className={`gp-btn${confirmingDeleteId === pool.id ? " gp-btn--danger-confirm" : " gp-btn--danger"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingDeleteId === pool.id) {
                        handleDelete(pool);
                      } else {
                        setConfirmingDeleteId(pool.id);
                      }
                    }}
                    onBlur={() => setConfirmingDeleteId(null)}
                  >
                    {confirmingDeleteId === pool.id
                      ? t["goalPool.confirmDelete"]
                      : t["goalPool.delete"]}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {importError && <p className="gp-error">{importError}</p>}

          <div className="gp-footer">
            <button
              type="button"
              className="gp-btn gp-btn--primary"
              onClick={handleCreate}
            >
              + {t["goalPool.new"]}
            </button>
            <label
              className="gp-btn gp-btn--primary"
              title={t["editor.importJson"]}
            >
              {t["editor.importJson"]}
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  handleImportJson(e);
                }}
                className="gp-import-input"
              />
            </label>
          </div>
        </div>
      </div>

      {editingMetaPool && (
        <PoolMetaEditor
          pool={editingMetaPool}
          uploadQueue={uploadQueue ?? null}
          onSave={handleSaveMeta}
          onClose={() => setEditingMetaId(null)}
        />
      )}
    </div>
  );
}
