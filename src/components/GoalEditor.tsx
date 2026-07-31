import Papa from "papaparse";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useT, format } from "../i18n/useT";
import { langCodes, langDescriptors } from "../i18n/translations";
import { Lightbox } from "./Lightbox";
import type { Lang } from "../i18n/translations";
import type { Translations } from "../i18n/types";
import type { GoalItem, ImageAttachment } from "../types";
import {
  getGoalCounter,
  getGoalDifficulty,
  getGoalGroup,
  getGoalGlobalGroup,
  getGoalText,
  getGoalTooltip,
  getGoalImages,
} from "../types";
import {
  fileToImageAttachment,
  type ImageUploadQueue,
  type UploadStatusInfo,
  getImageSrc,
} from "../utils/imageService";
import "./GoalEditor.css";

function LineNumberedTextArea({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  readOnly?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  return (
    <div className="ge-lineno-wrap">
      <div className="ge-lineno-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="ge-lineno-line">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        className="ge-json-textarea ge-lineno-textarea"
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        onScroll={() => {
          if (gutterRef.current && textareaRef.current) {
            gutterRef.current.scrollTop = textareaRef.current.scrollTop;
          }
        }}
      />
    </div>
  );
}

function goalToJson(item: GoalItem): unknown {
  if (typeof item === "string") return item;
  const obj: Record<string, unknown> = { text: item.text };
  if (item.tooltip) obj.tooltip = item.tooltip;
  if (item.difficulty !== undefined) obj.difficulty = item.difficulty;
  if (item.group) {
    const eg = item.group;
    obj.group = Array.isArray(eg) && eg.length === 1 ? eg[0] : eg;
  }
  if (item.globalGroup) {
    const gg = item.globalGroup;
    obj.globalGroup = Array.isArray(gg) && gg.length === 1 ? gg[0] : gg;
  }
  if (item.counter) obj.counter = item.counter;
  if (item.text_i18n && Object.keys(item.text_i18n).length > 0)
    obj.text_i18n = item.text_i18n;
  if (item.tooltip_i18n && Object.keys(item.tooltip_i18n).length > 0)
    obj.tooltip_i18n = item.tooltip_i18n;
  if (item.images && item.images.length > 0)
    obj.images = item.images.map(({ hash, filename, mimeType, data }) => ({
      hash,
      filename,
      mimeType,
      ...(data ? { data } : {}),
    }));
  return obj;
}

function goalToCsv(item: GoalItem): string {
  if (typeof item === "string")
    return Papa.unparse([[item.replace(/\r?\n/g, " ")]], {
      delimiter: ",",
      newline: "",
    });
  const cols: string[] = [
    item.text.replace(/\r?\n/g, " "),
    item.tooltip ?? "",
    item.counter ? String(item.counter) : "",
    item.difficulty !== undefined ? String(item.difficulty) : "",
    item.group
      ? Array.isArray(item.group)
        ? item.group.join("|")
        : item.group
      : "",
    item.globalGroup
      ? Array.isArray(item.globalGroup)
        ? item.globalGroup.join("|")
        : item.globalGroup
      : "",
  ];
  while (cols.length > 1 && cols[cols.length - 1] === "") cols.pop();
  return Papa.unparse([cols], { delimiter: ",", newline: "" });
}

function parseCsv(
  text: string,
  t: Translations,
  fmt: (template: string, ...args: (string | number)[]) => string,
  onError: (msg: string) => void,
): GoalItem[] | null {
  const result = Papa.parse(text, { delimiter: ",", header: false });
  if (result.errors.length > 0) {
    onError(result.errors[0].message);
    return null;
  }

  const rows = result.data as string[][];
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ""));
  const items: GoalItem[] = [];
  for (let i = 0; i < nonEmpty.length; i++) {
    const cols = nonEmpty[i];
    const textVal = (cols[0] ?? "").trim().replace(/\r?\n/g, " ");
    if (!textVal) {
      onError(fmt(t["editor.csvEmptyText"], i + 1));
      return null;
    }

    const tooltip = (cols[1] ?? "").trim() || undefined;
    const counterStr = (cols[2] ?? "").trim();
    const diffStr = (cols[3] ?? "").trim();
    const exclStr = (cols[4] ?? "").trim().replace(/\r?\n/g, " ");
    const globExclStr = (cols[5] ?? "").trim().replace(/\r?\n/g, " ");

    let difficulty: number | undefined;
    if (diffStr) {
      const d = parseInt(diffStr, 10);
      if (!Number.isInteger(d) || d < 1 || d > 5) {
        onError(fmt(t["editor.csvBadDifficulty"], i + 1, diffStr));
        return null;
      }
      difficulty = d;
    }

    let group: string | string[] | undefined;
    if (exclStr) {
      const parts = exclStr
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        onError(fmt(t["editor.csvBadGroup"], i + 1));
        return null;
      }
      group = parts.length === 1 ? parts[0] : parts;
    }

    let globalGroup: string | string[] | undefined;
    if (globExclStr) {
      const parts = globExclStr
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) {
        onError(fmt(t["editor.csvBadGlobalGroup"], i + 1));
        return null;
      }
      globalGroup = parts.length === 1 ? parts[0] : parts;
    }

    let counter: number | undefined;
    if (counterStr) {
      const c = parseInt(counterStr, 10);
      if (!Number.isInteger(c) || c < 0) {
        onError(fmt(t["editor.csvBadCounter"], i + 1, counterStr));
        return null;
      }
      counter = c;
    }

    const item = normalizeGoalItem({
      text: textVal,
      ...(tooltip && { tooltip }),
      ...(difficulty !== undefined && { difficulty }),
      ...(group !== undefined && { group }),
      ...(globalGroup !== undefined && { globalGroup }),
      ...(counter !== undefined && { counter }),
    });
    items.push(item);
  }
  return items;
}

function normalizeGoalItem(item: GoalItem): GoalItem {
  if (typeof item === "string") return item;
  const {
    text,
    tooltip,
    difficulty,
    group,
    globalGroup,
    counter,
    text_i18n,
    tooltip_i18n,
    images,
  } = item;
  if (
    !tooltip &&
    difficulty === undefined &&
    !group &&
    !globalGroup &&
    !counter &&
    !text_i18n &&
    !tooltip_i18n &&
    (!images || images.length === 0)
  ) {
    return text;
  }
  return item;
}

function hasTranslation(item: GoalItem): boolean {
  return (
    typeof item === "object" &&
    !!(
      (item.text_i18n && Object.keys(item.text_i18n).length > 0) ||
      (item.tooltip_i18n && Object.keys(item.tooltip_i18n).length > 0)
    )
  );
}

// CSV 无法表示图片和翻译，任务池包含这些字段时 CSV 模式只读
function hasCsvUnsupported(item: GoalItem): boolean {
  return getGoalImages(item).length > 0 || hasTranslation(item);
}

function isValidGoalItem(item: unknown): item is GoalItem {
  if (typeof item === "string") return true;
  if (
    item &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).text === "string"
  ) {
    const d = (item as Record<string, unknown>).difficulty;
    if (
      d !== undefined &&
      d !== null &&
      !(typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 5)
    )
      return false;
    const eg = (item as Record<string, unknown>).group;
    if (
      eg !== undefined &&
      eg !== null &&
      typeof eg !== "string" &&
      !(Array.isArray(eg) && eg.every((v) => typeof v === "string"))
    )
      return false;
    const geg = (item as Record<string, unknown>).globalGroup;
    if (
      geg !== undefined &&
      geg !== null &&
      typeof geg !== "string" &&
      !(Array.isArray(geg) && geg.every((v) => typeof v === "string"))
    )
      return false;
    const cm = (item as Record<string, unknown>).counter;
    if (
      cm !== undefined &&
      cm !== null &&
      !(typeof cm === "number" && Number.isInteger(cm) && cm >= 0)
    )
      return false;
    const imgs = (item as Record<string, unknown>).images;
    if (imgs !== undefined && imgs !== null) {
      if (!Array.isArray(imgs)) return false;
      const HASH_RE = /^[a-f0-9]{64}$/;
      if (
        !imgs.every(
          (img) =>
            typeof img === "object" &&
            img !== null &&
            typeof (img as Record<string, unknown>).hash === "string" &&
            HASH_RE.test((img as Record<string, unknown>).hash as string) &&
            typeof (img as Record<string, unknown>).filename === "string" &&
            typeof (img as Record<string, unknown>).mimeType === "string" &&
            ((img as Record<string, unknown>).data === undefined ||
              typeof (img as Record<string, unknown>).data === "string"),
        )
      )
        return false;
    }
    const ti18n = (item as Record<string, unknown>).text_i18n;
    if (ti18n !== undefined && ti18n !== null) {
      if (typeof ti18n !== "object" || Array.isArray(ti18n)) return false;
      if (
        !Object.values(ti18n as Record<string, unknown>).every(
          (v) => typeof v === "string",
        )
      )
        return false;
    }
    const tpi18n = (item as Record<string, unknown>).tooltip_i18n;
    if (tpi18n !== undefined && tpi18n !== null) {
      if (typeof tpi18n !== "object" || Array.isArray(tpi18n)) return false;
      if (
        !Object.values(tpi18n as Record<string, unknown>).every(
          (v) => typeof v === "string",
        )
      )
        return false;
    }
    return true;
  }
  return false;
}

/* ── TagInput ────────────────────────────────────────────────────── */

function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filtered = text.trim()
    ? suggestions.filter(
        (s) =>
          s.toLowerCase().includes(text.toLowerCase()) && !value.includes(s),
      )
    : [];

  const add = (group: string) => {
    const g = group.trim();
    if (g && !value.includes(g)) onChange([...value, g]);
    setText("");
    setShowSuggestions(false);
  };

  const remove = (group: string) => {
    onChange(value.filter((v) => v !== group));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0 && showSuggestions) {
        add(filtered[0]);
      } else if (text.trim()) {
        add(text);
      }
    }
    if (e.key === "Backspace" && !text && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  const handleBlur = () => {
    setShowSuggestions(false);
    if (text.trim()) add(text);
  };

  return (
    <div
      className="tag-input"
      onFocus={() => setShowSuggestions(true)}
      onBlur={handleBlur}
    >
      <div className="tag-input-tags">
        {value.map((g) => (
          <span key={g} className="tag-input-tag">
            {g}
            <button
              type="button"
              className="tag-input-remove"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => remove(g)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-input-text"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKey}
          placeholder={value.length === 0 ? placeholder : ""}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div className="tag-input-dropdown">
          {filtered.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              className="tag-input-option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── TranslateView ────────────────────────────────────────────────── */

type SourceRef = Lang | "__orig";

function getSourceText(item: GoalItem, ref: SourceRef): string {
  if (ref === "__orig") return typeof item === "string" ? item : item.text;
  return getGoalText(item, ref);
}

function getSourceTooltip(item: GoalItem, ref: SourceRef): string | undefined {
  if (ref === "__orig")
    return typeof item === "string" ? undefined : item.tooltip;
  return getGoalTooltip(item, ref);
}

function getTargetText(item: GoalItem, lang: Lang): string {
  if (typeof item === "string") return "";
  return item.text_i18n?.[lang] ?? "";
}

function getTargetTooltip(item: GoalItem, lang: Lang): string {
  if (typeof item === "string") return "";
  return item.tooltip_i18n?.[lang] ?? "";
}

interface TranslateViewProps {
  goals: GoalItem[];
  source: SourceRef;
  target: Lang;
  onSourceChange: (s: SourceRef) => void;
  onTargetChange: (l: Lang) => void;
  onChange: (goals: GoalItem[]) => void;
  onAddGoal: () => void;
  t: Translations;
}

function TranslateView({
  goals,
  source,
  target,
  onSourceChange,
  onTargetChange,
  onChange,
  onAddGoal,
  t,
}: TranslateViewProps) {
  const updateTranslation = (
    index: number,
    field: "text" | "tooltip",
    value: string,
  ) => {
    const next = [...goals];
    const item = next[index];
    const i18nKey = field === "text" ? "text_i18n" : "tooltip_i18n";

    const base = typeof item === "string" ? { text: item } : { ...item };
    const newI18n = { ...base[i18nKey] };
    if (value.trim()) {
      newI18n[target] = value;
    } else {
      delete newI18n[target];
    }
    const updated = { ...base };
    if (Object.keys(newI18n).length > 0) {
      (updated as Record<string, unknown>)[i18nKey] = newI18n;
    } else {
      delete (updated as Record<string, unknown>)[i18nKey];
    }
    next[index] = normalizeGoalItem(updated as GoalItem);
    onChange(next);
  };

  return (
    <>
      <div className="ge-translate-list">
        <div className="ge-translate-header">
          <span className="ge-translate-index" />
          <div className="ge-translate-source">
            <span className="ge-translate-label">
              {t["editor.translateSource"]}：
            </span>
            <select
              className="ge-translate-select"
              value={source}
              onChange={(e) => onSourceChange(e.target.value as SourceRef)}
            >
              <option value="__orig">{t["editor.translateOrigOption"]}</option>
              {langCodes.map((lc) => (
                <option key={lc} value={lc}>
                  {langDescriptors[lc].displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="ge-translate-target">
            <span className="ge-translate-label">
              {t["editor.translateTarget"]}：
            </span>
            <select
              className="ge-translate-select"
              value={target}
              onChange={(e) => onTargetChange(e.target.value as Lang)}
            >
              {langCodes.map((lc) => (
                <option key={lc} value={lc}>
                  {langDescriptors[lc].displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {goals.map((item, i) => (
          <div key={i} className="ge-translate-row">
            <span className="ge-translate-index">{i + 1}</span>
            <div
              className="ge-translate-source"
              data-label={t["editor.translateSource"]}
            >
              <div className="ge-translate-source-text">
                {getSourceText(item, source)}
              </div>
              {getSourceTooltip(item, source) && (
                <div className="ge-translate-source-tooltip">
                  {getSourceTooltip(item, source)}
                </div>
              )}
            </div>
            <div
              className="ge-translate-target"
              data-label={t["editor.translateTarget"]}
            >
              <input
                className="ge-translate-text-input"
                type="text"
                value={getTargetText(item, target)}
                placeholder={getSourceText(item, source)}
                onChange={(e) => updateTranslation(i, "text", e.target.value)}
              />
              <textarea
                className="ge-translate-tooltip-input"
                value={getTargetTooltip(item, target)}
                placeholder={getSourceTooltip(item, source) || ""}
                onChange={(e) =>
                  updateTranslation(i, "tooltip", e.target.value)
                }
                rows={2}
              />
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="ge-add-btn" onClick={onAddGoal}>
        {t["editor.addGoal"]}
      </button>
    </>
  );
}

type GoalPatch = Partial<{
  text: string;
  tooltip: string;
  difficulty: number | undefined;
  group: string | string[];
  globalGroup: string | string[];
  counter: number;
  images: ImageAttachment[];
}>;

const EMPTY_STATUS_MAP = new Map<string, UploadStatusInfo>();

interface GoalEditorItemProps {
  index: number;
  goal: GoalItem;
  allGroups: string[];
  allGlobalGroups: string[];
  t: Translations;
  onUpdate: (index: number, patch: GoalPatch) => void;
  onRemove: (index: number) => void;
  uploadQueue: ImageUploadQueue | null;
}

function GoalEditorItem({
  index,
  goal,
  allGroups,
  allGlobalGroups,
  t,
  onUpdate,
  onRemove,
  uploadQueue,
}: GoalEditorItemProps) {
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [renamingHash, setRenamingHash] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const images = getGoalImages(goal);

  // Upload statuses — subscribe to the queue as an external store.
  // The snapshot reference only changes when a status does, so
  // getSnapshot can be called during render without side effects.
  const allStatuses = useSyncExternalStore(
    uploadQueue ? (cb) => uploadQueue.onStatusChange(cb) : () => () => {},
    () => uploadQueue?.getSnapshot() ?? EMPTY_STATUS_MAP,
  );
  const imageStatuses = new Map<string, UploadStatusInfo>(
    images.map((im) => [
      im.hash,
      allStatuses.get(im.hash) ?? { status: "pending" },
    ]),
  );

  const handleAddImages = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const existingImages = getGoalImages(goal);
      const newAtts: ImageAttachment[] = [...existingImages];

      for (const file of files) {
        try {
          const att = await fileToImageAttachment(file);
          // Dedup by hash
          if (newAtts.some((a) => a.hash === att.hash)) continue;
          newAtts.push(att);
          // Upload in background
          if (uploadQueue) {
            uploadQueue.enqueue(att);
          }
        } catch (err) {
          // Show a simple alert for validation errors
          if (err instanceof Error) {
            alert(err.message);
          }
        }
      }

      onUpdate(index, {
        images: newAtts.length > 0 ? newAtts : [],
      });

      // Reset file input
      e.target.value = "";
    },
    [goal, index, onUpdate, uploadQueue],
  );

  const handleRemoveImage = useCallback(
    (hash: string) => {
      const filtered = images.filter((a) => a.hash !== hash);
      onUpdate(index, { images: filtered });
    },
    [images, index, onUpdate],
  );

  const handleRetryImage = useCallback(
    (att: ImageAttachment) => {
      if (uploadQueue) {
        uploadQueue.retry(att.hash);
        uploadQueue.enqueue(att);
      }
    },
    [uploadQueue],
  );

  const handleStartRename = useCallback(
    (att: ImageAttachment, e: React.MouseEvent) => {
      e.stopPropagation();
      setRenamingHash(att.hash);
      setRenameText(att.filename);
    },
    [],
  );

  const handleCommitRename = useCallback(
    (hash: string) => {
      const trimmed = renameText.trim();
      if (trimmed && trimmed !== images.find((a) => a.hash === hash)?.filename) {
        const updated = images.map((a) =>
          a.hash === hash ? { ...a, filename: trimmed } : a,
        );
        onUpdate(index, { images: updated });
      }
      setRenamingHash(null);
      setRenameText("");
    },
    [renameText, images, index, onUpdate],
  );

  const handleRenameKeyDown = useCallback(
    (hash: string, e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCommitRename(hash);
      } else if (e.key === "Escape") {
        setRenamingHash(null);
        setRenameText("");
      }
    },
    [handleCommitRename],
  );
  return (
    <div className="ge-item">
      <span className="ge-item-index">{index + 1}</span>
      <div className="ge-item-fields">
        <div className="ge-item-row">
          <input
            className="ge-item-text"
            type="text"
            value={getGoalText(goal)}
            onChange={(e) =>
              onUpdate(index, { text: e.target.value.replace(/\r?\n/g, " ") })
            }
            placeholder={t["editor.textPlaceholder"]}
          />
          <input
            className="ge-item-difficulty"
            type="number"
            min={1}
            max={5}
            value={getGoalDifficulty(goal) || ""}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                onUpdate(index, { difficulty: undefined });
                return;
              }
              const v = parseInt(raw, 10);
              if (isNaN(v) || v < 1 || v > 5) return;
              onUpdate(index, { difficulty: v });
            }}
            placeholder={t["editor.difficulty"]}
          />
          <input
            className="ge-item-counters"
            type="number"
            min={0}
            value={getGoalCounter(goal) || ""}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onUpdate(index, { counter: isNaN(v) ? 0 : Math.max(0, v) });
            }}
            placeholder={t["editor.counter"]}
          />
        </div>
        <div className="ge-item-meta">
          <textarea
            className="ge-item-tooltip"
            value={getGoalTooltip(goal) || ""}
            onChange={(e) => onUpdate(index, { tooltip: e.target.value })}
            placeholder={t["editor.tooltipPlaceholder"]}
            rows={2}
          />
        </div>
        <div className="ge-item-meta">
          <TagInput
            value={getGoalGroup(goal)}
            onChange={(v) => onUpdate(index, { group: v })}
            suggestions={allGroups}
            placeholder={t["editor.group"]}
          />
          <TagInput
            value={getGoalGlobalGroup(goal)}
            onChange={(v) => onUpdate(index, { globalGroup: v })}
            suggestions={allGlobalGroups}
            placeholder={t["editor.globalGroup"]}
          />
        </div>
        <div className="ge-item-images">
          {images.map((att) => {
            const status = imageStatuses.get(att.hash);
            const isError = status?.status === "error";
            const isUploading = status?.status === "uploading";
            const isPending = !status || status.status === "pending";
            return (
              <div
                key={att.hash}
                className={`ge-item-image-thumb${isError ? " ge-item-image-thumb--error" : ""}${isUploading || isPending ? " ge-item-image-thumb--uploading" : ""}`}
              >
                <div
                  className="ge-item-image-frame"
                  title={isError ? `${t["editor.imageFailed"]}: ${status?.error ?? ""}` : att.filename}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewIdx(images.indexOf(att));
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      e.preventDefault();
                      setPreviewIdx(images.indexOf(att));
                    }
                  }}
                >
                  <img
                    src={getImageSrc(att)}
                    alt={att.filename}
                    className="ge-item-image-preview"
                  />
                  {isUploading || isPending ? (
                    <span className="ge-item-image-status ge-item-image-status--spinner" />
                  ) : isError ? (
                    <button
                      type="button"
                      className="ge-item-image-status ge-item-image-status--retry"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryImage(att);
                      }}
                      title={t["editor.imageFailed"]}
                    >
                      ↻
                    </button>
                  ) : (
                    <span className="ge-item-image-status ge-item-image-status--done">
                      ✓
                    </span>
                  )}
                  <button
                    type="button"
                    className="ge-item-image-remove"
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
                    className="ge-item-image-rename-input"
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
                    className="ge-item-image-name"
                    onClick={(e) => handleStartRename(att, e)}
                    title={`${att.filename} — 点击重命名`}
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
          <label className="ge-item-image-add">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                void handleAddImages(e);
              }}
              className="ge-item-image-input"
            />
            + {t["editor.addImages"]}
          </label>
        </div>
      </div>
      <button
        type="button"
        className="ge-item-remove"
        onClick={() => onRemove(index)}
        title={t["editor.remove"]}
      >
        ✕
      </button>

      {/* Lightbox preview */}
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

interface Props {
  goals: GoalItem[];
  onChange: (goals: GoalItem[]) => void;
  onClose: () => void;
  uploadQueue?: ImageUploadQueue | null;
}

export function GoalEditor({ goals, onChange, onClose, uploadQueue }: Props) {
  const { t, lang } = useT();

  const [editorMode, setEditorMode] = useState<
    "visual" | "translate" | "json" | "csv"
  >("visual");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");
  const [translateSource, setTranslateSource] = useState<"__orig" | Lang>(
    "__orig",
  );
  const [translateTarget, setTranslateTarget] = useState<Lang>(lang);
  const [jsonFolded, setJsonFolded] = useState(false);
  const [importError, setImportError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const mouseDownOnOverlay = useRef(false);
  const goalsRef = useRef(goals);
  useEffect(() => {
    goalsRef.current = goals;
  });

  const allGroupsKey = useMemo(() => {
    const s = new Set<string>();
    for (const g of goals) {
      for (const eg of getGoalGroup(g)) s.add(eg);
    }
    return Array.from(s).sort().join("\0");
  }, [goals]);
  const allGroups = useMemo(
    () => (allGroupsKey ? allGroupsKey.split("\0") : []),
    [allGroupsKey],
  );

  const allGlobalGroupsKey = useMemo(() => {
    const s = new Set<string>();
    for (const g of goals) {
      for (const gg of getGoalGlobalGroup(g)) s.add(gg);
    }
    return Array.from(s).sort().join("\0");
  }, [goals]);
  const allGlobalGroups = useMemo(
    () => (allGlobalGroupsKey ? allGlobalGroupsKey.split("\0") : []),
    [allGlobalGroupsKey],
  );

  const tryApplyJson = (): GoalItem[] | null => {
    setJsonError("");
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        setJsonError(t["editor.jsonNotArray"]);
        return null;
      }
      const items: GoalItem[] = [];
      for (let i = 0; i < parsed.length; i++) {
        if (!isValidGoalItem(parsed[i])) {
          setJsonError(format(t["editor.jsonInvalidItem"], i + 1));
          return null;
        }
        const item = normalizeGoalItem(parsed[i]);
        if (typeof item === "string") {
          items.push(item.replace(/\r?\n/g, " "));
        } else {
          const cleanGroup = (g: string | string[]): string | string[] =>
            typeof g === "string"
              ? g.replace(/\r?\n/g, " ")
              : g.map((s) => s.replace(/\r?\n/g, " "));
          items.push({
            ...item,
            text: item.text.replace(/\r?\n/g, " "),
            ...(item.group && { group: cleanGroup(item.group) }),
            ...(item.globalGroup && {
              globalGroup: cleanGroup(item.globalGroup),
            }),
          });
        }
      }
      return items;
    } catch (e) {
      setJsonError(
        `${t["editor.jsonParseError"]}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  };

  const switchMode = (mode: "visual" | "translate" | "json" | "csv") => {
    if (mode === editorMode) return;

    let currentGoals = goalsRef.current;
    const csvReadOnly = currentGoals.some(hasCsvUnsupported);

    if (editorMode === "json") {
      const items = tryApplyJson();
      if (!items) return;
      onChange(items);
      currentGoals = items;
    } else if (editorMode === "csv" && !csvReadOnly) {
      // Apply CSV edits only if no images/translations (CSV can't represent them)
      setCsvError("");
      const items = parseCsv(csvText, t, format, (msg) => setCsvError(msg));
      if (!items) return;
      onChange(items);
      currentGoals = items;
    }

    if (mode === "visual") {
      setEditorMode("visual");
    } else if (mode === "translate") {
      setEditorMode("translate");
    } else if (mode === "json") {
      setJsonText(JSON.stringify(currentGoals.map(goalToJson), null, 2));
      setJsonError("");
      // Auto-fold if goals contain images (base64 strings make JSON unreadable)
      setJsonFolded(currentGoals.some((g) => getGoalImages(g).length > 0));
      setEditorMode("json");
    } else {
      setCsvText(currentGoals.map(goalToCsv).join("\n"));
      setCsvError("");
      setEditorMode("csv");
    }
  };

  // JSON file import/export
  const handleExportJson = useCallback(() => {
    const json = JSON.stringify(goals.map(goalToJson), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "goal-pool.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [goals]);

  const handleImportJson = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setImportError("");
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (!Array.isArray(parsed)) {
            setImportError(t["editor.jsonNotArray"]);
            return;
          }
          const items: GoalItem[] = [];
          for (let i = 0; i < parsed.length; i++) {
            if (!isValidGoalItem(parsed[i])) {
              setImportError(format(t["editor.jsonInvalidItem"], i + 1));
              return;
            }
            items.push(normalizeGoalItem(parsed[i]));
          }
          onChange(items);
          if (editorMode === "json") {
            setJsonText(JSON.stringify(items.map(goalToJson), null, 2));
            setJsonFolded(items.some((g) => getGoalImages(g).length > 0));
          }
        } catch (err) {
          setImportError(
            `${t["editor.jsonParseError"]}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [onChange, t, editorMode],
  );

  const handleClose = () => {
    if (editorMode === "json") {
      const items = tryApplyJson();
      if (items) onChange(items);
    } else if (editorMode === "csv" && !goalsRef.current.some(hasCsvUnsupported)) {
      setCsvError("");
      const items = parseCsv(csvText, t, format, () => {});
      if (items) onChange(items);
    }
    onClose();
  };

  const updateGoal = useCallback(
    (index: number, patch: GoalPatch) => {
      const current = goalsRef.current;
      const next = [...current];
      const existing = next[index];
      const base =
        typeof existing === "string" ? { text: existing } : { ...existing };
      const merged: {
        text: string;
        tooltip?: string;
        difficulty?: number;
        group?: string | string[];
        globalGroup?: string | string[];
        counter?: number;
        images?: ImageAttachment[];
      } = { ...base, ...patch };
      if (!merged.tooltip) delete merged.tooltip;
      if (merged.difficulty === undefined || merged.difficulty === 0)
        delete merged.difficulty;
      if (
        !merged.group ||
        (Array.isArray(merged.group) && merged.group.length === 0)
      )
        delete merged.group;
      if (
        !merged.globalGroup ||
        (Array.isArray(merged.globalGroup) && merged.globalGroup.length === 0)
      )
        delete merged.globalGroup;
      if (!merged.counter || merged.counter === 0) delete merged.counter;
      if (!merged.images || merged.images.length === 0) delete merged.images;
      if (
        !merged.tooltip &&
        merged.difficulty === undefined &&
        !merged.group &&
        !merged.globalGroup &&
        !merged.counter &&
        !merged.images
      ) {
        next[index] = merged.text;
      } else {
        next[index] = merged as GoalItem;
      }
      onChange(next);
    },
    [onChange],
  );

  const addGoal = () => {
    const label = t["editor.defaultGoalLabel"];
    const currentAdd = goalsRef.current;
    onChange([...currentAdd, `${label} ${currentAdd.length + 1}`]);
    setTimeout(() => {
      if (listRef.current)
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 50);
  };

  const removeGoal = useCallback(
    (index: number) => onChange(goalsRef.current.filter((_, i) => i !== index)),
    [onChange],
  );

  return (
    <div
      className="goal-editor-overlay"
      onMouseDown={(e) => {
        mouseDownOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (mouseDownOnOverlay.current) handleClose();
      }}
    >
      <div className="goal-editor" onClick={(e) => e.stopPropagation()}>
        <div className="goal-editor-header">
          <h2 className="goal-editor-title">{t["editor.title"]}</h2>
          <button
            type="button"
            className="goal-editor-close"
            onClick={handleClose}
          >
            ✕
          </button>
        </div>

        <div className="goal-editor-toolbar">
          <div className="goal-editor-toolbar-modes">
            <button
              type="button"
              className={`ge-btn${editorMode === "visual" ? " ge-btn--active" : ""}`}
              onClick={() => switchMode("visual")}
            >
              {t["editor.visualMode"]}
            </button>
            <button
              type="button"
              className={`ge-btn${editorMode === "translate" ? " ge-btn--active" : ""}`}
              onClick={() => switchMode("translate")}
            >
              {t["editor.translateMode"]}
            </button>
            <button
              type="button"
              className={`ge-btn${editorMode === "json" ? " ge-btn--active" : ""}`}
              onClick={() => switchMode("json")}
            >
              {t["editor.editJson"]}
            </button>
            <button
              type="button"
              className={`ge-btn${editorMode === "csv" ? " ge-btn--active" : ""}`}
              onClick={() => switchMode("csv")}
            >
              {t["editor.editCsv"]}
            </button>
          </div>
          <div className="goal-editor-toolbar-actions">
            <button
              type="button"
              className="ge-btn"
              onClick={handleExportJson}
              title={t["editor.exportJson"]}
            >
              📤 {t["editor.exportJson"]}
            </button>
            <label className="ge-btn" title={t["editor.importJson"]}>
              📥 {t["editor.importJson"]}
              <input
                type="file"
                accept=".json"
                onChange={(e) => {
                  void handleImportJson(e);
                }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        </div>

        {editorMode === "json" && (
          <div className="goal-editor-json">
            {jsonFolded ? (
              <div className="ge-json-folded">
                <p className="ge-json-hint">{t["editor.imagesInJson"]}</p>
                <button
                  type="button"
                  className="ge-btn"
                  onClick={() => setJsonFolded(false)}
                >
                  {t["editor.showJsonAnyway"]}
                </button>
              </div>
            ) : (
              <>
                <LineNumberedTextArea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError("");
                  }}
                />
                {jsonError && <p className="ge-json-error">{jsonError}</p>}
              </>
            )}
            {importError && <p className="ge-json-error">{importError}</p>}
          </div>
        )}
        {editorMode === "csv" && (
          <div className="goal-editor-json">
            <p className="ge-json-hint">{t["editor.csvHint"]}</p>
            {goals.some(hasCsvUnsupported) && (
              <p className="ge-json-hint ge-json-hint--warn">
                {t["editor.csvReadOnly"]}
              </p>
            )}
            <LineNumberedTextArea
              value={csvText}
              readOnly={goals.some(hasCsvUnsupported)}
              onChange={(e) => {
                setCsvText(e.target.value);
                setCsvError("");
              }}
            />
            {csvError && <p className="ge-json-error">{csvError}</p>}
          </div>
        )}
        {editorMode === "translate" && (
          <TranslateView
            goals={goals}
            source={translateSource}
            target={translateTarget}
            onSourceChange={setTranslateSource}
            onTargetChange={setTranslateTarget}
            onChange={onChange}
            onAddGoal={addGoal}
            t={t}
          />
        )}
        {editorMode === "visual" && (
          <>
            <div className="goal-editor-list" ref={listRef}>
              {goals.length === 0 && (
                <p className="goal-editor-empty">{t["editor.empty"]}</p>
              )}
              {goals.map((g, i) => (
                <GoalEditorItem
                  key={i}
                  index={i}
                  goal={g}
                  allGroups={allGroups}
                  allGlobalGroups={allGlobalGroups}
                  t={t}
                  onUpdate={updateGoal}
                  onRemove={removeGoal}
                  uploadQueue={uploadQueue ?? null}
                />
              ))}
            </div>

            <button type="button" className="ge-add-btn" onClick={addGoal}>
              {t["editor.addGoal"]}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
