import { useState, useRef, useEffect } from "react";
import type { ScoringRule, ScoringItem } from "../scoring/types";
import { tokenize, parse } from "../scoring/expressionParser";
import { useT } from "../i18n/useT";
import "./ScoringRuleEditor.css";

/* ── LineNumberedTextArea ─────────────────────────────────────────── */

function LineNumberedTextArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  return (
    <div className="sre-lineno-wrap">
      <div className="sre-lineno-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="sre-lineno-line">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="sre-json-textarea sre-lineno-textarea"
        value={value}
        onChange={onChange}
        onScroll={() => {
          if (gutterRef.current && textareaRef.current) {
            gutterRef.current.scrollTop = textareaRef.current.scrollTop;
          }
        }}
      />
    </div>
  );
}

/* ── JSON helpers ─────────────────────────────────────────────────── */

function positionToLine(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function ruleToJson(name: string, items: ScoringItem[]): string {
  const obj = {
    name,
    items: items.map((item) => {
      const it: Record<string, unknown> = {
        target: item.target,
        points: item.points,
      };
      if (item.condition) it.condition = item.condition;
      if (item.label) it.label = item.label;
      return it;
    }),
  };
  return JSON.stringify(obj, null, 2);
}

interface Props {
  rule: ScoringRule | null;
  onSave: (rule: ScoringRule) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
  /** Existing rule names (excluding the rule being edited) — used to generate a unique default name. */
  existingNames?: string[];
}

let nextId = 1;
function uid(): string {
  return `si_${nextId++}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Generate a unique default rule name like "规则 1", "规则 2"… */
function defaultRuleName(
  base: string,
  existingNames: string[],
): string {
  let n = existingNames.length + 1;
  let name = `${base} ${n}`;
  while (existingNames.includes(name)) {
    n++;
    name = `${base} ${n}`;
  }
  return name;
}

function emptyItem(): ScoringItem {
  return { id: uid(), target: "cell", points: "1" };
}

function validateExpr(expr: string): string | null {
  if (!expr.trim()) return "Empty expression";
  try {
    tokenize(expr);
    parse(expr);
    return null; // OK
  } catch (e) {
    return (e as Error).message;
  }
}

export function ScoringRuleEditor({ rule, onSave, onCancel, onDelete, existingNames = [] }: Props) {
  const { t } = useT();
  const mouseDownOnOverlay = useRef(false);

  const [name, setName] = useState(
    () => rule?.name ?? defaultRuleName(t["scoring.newDefaultName"], existingNames),
  );
  const [items, setItems] = useState<ScoringItem[]>(
    rule?.items.length ? rule.items.map((it) => ({ ...it })) : [emptyItem()],
  );
  const [editorMode, setEditorMode] = useState<"visual" | "json">("visual");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");

  // Ref to avoid stale closures in switchMode / handleClose
  const formRef = useRef({ name, items, id: rule?.id });
  useEffect(() => {
    formRef.current = { name, items, id: rule?.id };
  });

  const tryApplyJson = (text: string): boolean => {
    setJsonError("");
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError(t["scoring.jsonInvalidRule"]);
        return false;
      }
      if (typeof parsed.name !== "string" || !parsed.name.trim()) {
        setJsonError(t["scoring.jsonInvalidRule"]);
        return false;
      }
      if (!Array.isArray(parsed.items)) {
        setJsonError(t["scoring.jsonInvalidRule"]);
        return false;
      }
      const newItems: ScoringItem[] = [];
      for (let i = 0; i < parsed.items.length; i++) {
        const it = parsed.items[i];
        if (!it || typeof it !== "object") {
          setJsonError(t["scoring.jsonInvalidRule"]);
          return false;
        }
        if (it.target !== "cell" && it.target !== "bingo") {
          setJsonError(t["scoring.jsonInvalidRule"]);
          return false;
        }
        if (typeof it.points !== "string" || !it.points.trim()) {
          setJsonError(t["scoring.jsonInvalidRule"]);
          return false;
        }
        if (it.condition !== undefined && typeof it.condition !== "string") {
          setJsonError(t["scoring.jsonInvalidRule"]);
          return false;
        }
        if (it.label !== undefined && typeof it.label !== "string") {
          setJsonError(t["scoring.jsonInvalidRule"]);
          return false;
        }
        // Validate expressions
        const pointsErr = validateExpr(it.points);
        if (pointsErr) {
          setJsonError(`Item ${i + 1}: ${pointsErr}`);
          return false;
        }
        if (it.condition) {
          const condErr = validateExpr(it.condition);
          if (condErr) {
            setJsonError(`Item ${i + 1}: ${condErr}`);
            return false;
          }
        }

        newItems.push({
          id: uid(),
          target: it.target,
          points: it.points,
          ...(it.condition && { condition: it.condition }),
          ...(it.label && { label: it.label }),
        });
      }
      if (newItems.length === 0) {
        newItems.push(emptyItem());
      }
      const trimmedName = parsed.name.trim();
      setName(trimmedName);
      setItems(newItems);
      // Also update ref immediately so subsequent handleClose/switchMode
      // can read the fresh values before React re-renders.
      formRef.current = { name: trimmedName, items: newItems, id: rule?.id };
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Try to extract byte position from JSON.parse error message
      const posMatch = msg.match(/position\s+(\d+)/i);
      const line = posMatch
        ? positionToLine(text, parseInt(posMatch[1], 10))
        : null;
      setJsonError(
        line
          ? `${t["scoring.jsonParseError"]} line ${line}`
          : `${t["scoring.jsonParseError"]}: ${msg}`,
      );
      return false;
    }
  };

  const switchMode = (mode: "visual" | "json") => {
    if (mode === editorMode) return;

    if (editorMode === "json") {
      if (!tryApplyJson(jsonText)) return;
    }

    if (mode === "json") {
      setJsonText(ruleToJson(formRef.current.name, formRef.current.items));
      setJsonError("");
    }

    setEditorMode(mode);
  };

  // React Compiler auto-memoizes these handlers — no manual useCallback needed.
  const handleAddItem = () => {
    setItems((prev) => [...prev, emptyItem()]);
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((it) => it.id !== id);
    });
  };

  const handleItemChange = (id: string, patch: Partial<ScoringItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  };

  const handleClose = () => {
    // Auto-save on close (visual or JSON mode)
    if (editorMode === "json") {
      if (!tryApplyJson(jsonText)) return; // Invalid JSON, don't close
    }

    const current = formRef.current;
    const trimmedName = current.name.trim();
    if (!trimmedName) {
      onCancel();
      return;
    }

    // Validate all expressions
    for (const item of current.items) {
      if (validateExpr(item.points)) return;
      if (item.condition && validateExpr(item.condition)) return;
    }

    onSave({
      id: rule?.id ?? `custom_${Date.now()}`,
      name: trimmedName,
      items: current.items.filter((it) => it.points.trim()),
    });
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div
      className="sre-overlay"
      onMouseDown={(e) => {
        mouseDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (mouseDownOnOverlay.current) handleClose();
      }}
    >
      <div className="sre-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sre-modal-scroll">
          <h2 className="sre-title">
            {rule ? t["scoring.editRule"] : t["scoring.newRule"]}
          </h2>

          {/* Mode switcher */}
          <div className="sre-toolbar">
            <div className="sre-toolbar-modes">
              <button
                type="button"
                className={`ge-btn${editorMode === "visual" ? " ge-btn--active" : ""}`}
                onClick={() => switchMode("visual")}
              >
                {t["scoring.visualMode"]}
              </button>
              <button
                type="button"
                className={`ge-btn${editorMode === "json" ? " ge-btn--active" : ""}`}
                onClick={() => switchMode("json")}
              >
                {t["scoring.editJson"]}
              </button>
            </div>
          </div>

          {/* JSON mode */}
          {editorMode === "json" && (
            <div className="sre-json-area">
              <LineNumberedTextArea
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonError("");
                }}
              />
              {jsonError && <p className="sre-json-error">{jsonError}</p>}
            </div>
          )}

          {/* Visual mode */}
          {editorMode === "visual" && (
            <>
              {/* Rule name */}
              <label className="sre-field">
                <span className="sre-label">{t["scoring.ruleName"]}</span>
                <input
                  className="sre-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t["scoring.ruleName"]}
                  maxLength={40}
                  autoFocus
                />
              </label>

              {/* Items */}
              <div className="sre-items">
                <h3 className="sre-items-title">{t["scoring.customRules"]}</h3>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onChange={(patch) => handleItemChange(item.id, patch)}
                    onRemove={() => handleRemoveItem(item.id)}
                    canRemove={items.length > 1}
                  />
                ))}
                <button
                  type="button"
                  className="sre-add-btn"
                  onClick={handleAddItem}
                >
                  {t["scoring.addItem"]}
                </button>
              </div>

              {/* Variable reference */}
              <details className="sre-ref">
                <summary className="sre-ref-summary">
                  Variable Reference
                </summary>
                <div className="sre-ref-content">
                  <RefSection
                    title="cell"
                    items={[
                      "cell.row, cell.col — row/col (0-4)",
                      "cell.diag — on diagonal (true/false)",
                      "cell.difficulty — difficulty (1-5)",
                      "cell.counter — counter max value",
                      "cell.players.length — total markers",
                      "cell.players.indexOf(player) — my mark order",
                      "cell.bingos.length — bingo lines through this cell",
                    ]}
                  />
                  <RefSection
                    title="bingo"
                    items={[
                      'bingo.type — "row" | "col" | "diag"',
                      "bingo.index — line index",
                      "bingo.cells.length — cells in line (5)",
                      "bingo.cells[0].row — first cell's row",
                      "bingo.players.length — players who bingo'd this line",
                      "bingo.players.indexOf(player) — my bingo order on this line",
                    ]}
                  />
                  <RefSection
                    title="player"
                    items={[
                      "player.name — player display name",
                      "player.color — player color hex",
                      "player.bingos.length — total bingos by this player",
                      "player.bingos.indexOf(bingo) — global bingo order",
                    ]}
                  />
                  <RefSection
                    title="global"
                    items={[
                      "global.players.length — total player count",
                      "global.bingos.length — total bingo lines (all players)",
                      "global.bingos.indexOf(bingo) — global bingo order",
                    ]}
                  />
                  <RefSection
                    title="Functions"
                    items={[
                      "if(cond, t, f)  min(a,b)  max(a,b)",
                      "abs(x)  floor(x)  ceil(x)  round(x)",
                    ]}
                  />
                  <RefSection
                    title="Array methods"
                    items={[
                      "arr.all(|x| pred) — true if all elements satisfy",
                      "arr.any(|x| pred) — true if any element satisfies",
                      "arr.indexOf(item) — index of item in array (-1 if not found)",
                      "arr.length — number of elements",
                    ]}
                  />
                </div>
              </details>

              {/* Actions */}
              <div className="sre-actions">
                {rule && onDelete && (
                  <button
                    type="button"
                    className="sre-delete-btn"
                    onClick={() => onDelete(rule.id)}
                  >
                    {t["scoring.delete"]}
                  </button>
                )}
                <div className="sre-actions-right">
                  <button
                    type="button"
                    className="sre-cancel-btn"
                    onClick={handleCancel}
                  >
                    {t["scoring.cancel"]}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Item row
// ============================================================

function ItemRow({
  item,
  onChange,
  onRemove,
  canRemove,
}: {
  item: ScoringItem;
  onChange: (patch: Partial<ScoringItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useT();
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [condError, setCondError] = useState<string | null>(null);

  const checkPoints = (val: string) => {
    onChange({ points: val });
    const err = validateExpr(val);
    setPointsError(err);
  };

  const checkCond = (val: string) => {
    onChange({ condition: val });
    if (!val.trim()) {
      setCondError(null);
      return;
    }
    const err = validateExpr(val);
    setCondError(err);
  };

  return (
    <div className="sre-item">
      <div className="sre-item-row">
        {/* Target */}
        <select
          className="sre-select"
          value={item.target}
          onChange={(e) =>
            onChange({ target: e.target.value as "cell" | "bingo" })
          }
        >
          <option value="cell">{t["scoring.targetCell"]}</option>
          <option value="bingo">{t["scoring.targetBingo"]}</option>
        </select>

        {/* Points */}
        <input
          className={`sre-input sre-input-points ${pointsError ? "sre-input--error" : ""}`}
          type="text"
          value={item.points}
          onChange={(e) => checkPoints(e.target.value)}
          placeholder={t["scoring.points"]}
          title={pointsError ?? undefined}
        />

        {canRemove && (
          <button
            type="button"
            className="sre-remove-btn"
            onClick={onRemove}
            title={t["scoring.removeItem"]}
          >
            ✕
          </button>
        )}
      </div>

      <div className="sre-item-row sre-item-row--secondary">
        {/* Condition */}
        <input
          className={`sre-input sre-input-cond ${condError ? "sre-input--error" : ""}`}
          type="text"
          value={item.condition ?? ""}
          onChange={(e) => checkCond(e.target.value)}
          placeholder={t["scoring.condition"]}
          title={condError ?? undefined}
        />

        {/* Label */}
        <input
          className="sre-input sre-input-label"
          type="text"
          value={item.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          placeholder={t["scoring.itemLabel"]}
          maxLength={30}
        />
      </div>
    </div>
  );
}

// ============================================================
// Reference section helper
// ============================================================

function RefSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="sre-ref-section">
      <strong className="sre-ref-title">{title}</strong>
      {items.map((line, i) => (
        <code key={i} className="sre-ref-line">
          {line}
        </code>
      ))}
    </div>
  );
}
