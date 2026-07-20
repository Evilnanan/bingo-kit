import { useRef, useState } from "react";
import { useT, format } from "../i18n/useT";
import type { GoalItem, GoalPool } from "../types";
import { savePools } from "../utils/goalPoolStorage";
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
  onSelect: (poolId: string) => void;
  onUpdate: (pools: GoalPool[]) => void;
  onClose: () => void;
}

export function GoalPoolManager({
  pools,
  currentPoolId,
  defaultGoals,
  onSelect,
  onUpdate,
  onClose,
}: Props) {
  const { t } = useT();
  const mouseDownOnOverlay = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = (pool: GoalPool) => {
    setEditingId(pool.id);
    setEditName(pool.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (trimmed && trimmed !== pools.find((p) => p.id === editingId)?.name) {
      const updated = pools.map((p) =>
        p.id === editingId ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
      );
      savePools(updated);
      onUpdate(updated);
    }
    setEditingId(null);
  };

  const cancelRename = () => {
    setEditingId(null);
  };

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
    // Enter rename mode immediately for the new pool
    setEditingId(newPool.id);
    setEditName(name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const handleDelete = (pool: GoalPool) => {
    if (!window.confirm(format(t["goalPool.deleteConfirm"], pool.name))) return;
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
              >
                <div className="gp-item-info">
                  {editingId === pool.id ? (
                    <input
                      ref={renameInputRef}
                      className="gp-rename-input"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <span className="gp-item-name">{pool.name}</span>
                  )}
                  <span className="gp-item-count">
                    {format(t["goalPool.goalCount"], pool.goals.length)}
                  </span>
                </div>
                <div className="gp-item-actions">
                  {pool.id !== currentPoolId && (
                    <button
                      type="button"
                      className="gp-btn gp-btn--primary"
                      onClick={() => {
                        onSelect(pool.id);
                        onClose();
                      }}
                    >
                      {t["goalPool.selectBtn"]}
                    </button>
                  )}
                  <button
                    type="button"
                    className="gp-btn"
                    onClick={() => startRename(pool)}
                  >
                    {t["goalPool.rename"]}
                  </button>
                  <button
                    type="button"
                    className="gp-btn gp-btn--danger"
                    onClick={() => handleDelete(pool)}
                  >
                    {t["goalPool.delete"]}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="gp-footer">
            <button
              type="button"
              className="gp-btn gp-btn--primary"
              onClick={handleCreate}
            >
              + {t["goalPool.new"]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
