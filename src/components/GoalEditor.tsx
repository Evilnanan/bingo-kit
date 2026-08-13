import Papa from "papaparse";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useVirtualList,
  type VirtualListResult,
} from "../hooks/useVirtualList";
import { useT, format } from "../i18n/useT";
import { langCodes, langDescriptors } from "../i18n/translations";
import { Lightbox } from "./Lightbox";
import type { Lang } from "../i18n/translations";
import type { Translations } from "../i18n/types";
import type {
  GoalItem,
  ImageAttachment,
  PoolMetadata,
  VariantDef,
} from "../types";
import {
  getGoalCounter,
  getGoalDifficulty,
  getGoalGroup,
  getGoalGlobalGroup,
  getGoalText,
  getGoalTooltip,
  getGoalImages,
  getGoalVariants,
  hasGoalVariants,
} from "../types";
import {
  getPlaceholderRenameMap,
  remapVariantValues,
  renameTemplateTokens,
  listPlaceholders,
  hasAnonymousPlaceholder,
} from "../randomPicks/variants";
import {
  fileToImageAttachment,
  type ImageUploadQueue,
  type UploadStatusInfo,
  getImageSrc,
} from "../utils/imageService";
import {
  goalToJson,
  normalizeGoalItem,
  parsePoolJson,
} from "../utils/poolJson";
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

function hasTranslation(item: GoalItem): boolean {
  return (
    typeof item === "object" &&
    !!(
      (item.text_i18n && Object.keys(item.text_i18n).length > 0) ||
      (item.tooltip_i18n && Object.keys(item.tooltip_i18n).length > 0)
    )
  );
}

// CSV 无法表示图片、翻译和变体，任务池包含这些字段时 CSV 模式只读
function hasCsvUnsupported(item: GoalItem): boolean {
  return (
    getGoalImages(item).length > 0 ||
    hasTranslation(item) ||
    hasGoalVariants(item)
  );
}

/** Split a filter query on whitespace; double-quoted parts stay as one term. */
function splitFilterTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const raw = m[1] ?? m[2];
    const term = raw.replace(/^"+|"+$/g, "").trim();
    if (term) terms.push(term);
  }
  return terms;
}

/** Quote a term containing spaces so it stays a single filter keyword. */
function quoteFilterTerm(term: string): string {
  return /\s/.test(term) ? `"${term}"` : term;
}

/** Build the text searched by the text filter: text, tooltip, groups,
 *  translations and variant values. */
function getGoalSearchText(goal: GoalItem): string {
  const parts: string[] = [getGoalText(goal)];
  const tooltip = getGoalTooltip(goal);
  if (tooltip) parts.push(tooltip);
  parts.push(...getGoalGroup(goal), ...getGoalGlobalGroup(goal));
  if (typeof goal === "object") {
    if (goal.text_i18n) parts.push(...Object.values(goal.text_i18n));
    if (goal.tooltip_i18n) parts.push(...Object.values(goal.tooltip_i18n));
    for (const v of goal.variants ?? []) {
      parts.push(...Object.values(v.values));
      if (v.values_i18n) {
        for (const map of Object.values(v.values_i18n)) {
          parts.push(...Object.values(map));
        }
      }
    }
  }
  return parts.join("\n").toLowerCase();
}

function goalMatchesFilter(
  goal: GoalItem,
  terms: string[],
  difficulty: number | undefined,
): boolean {
  if (difficulty !== undefined && getGoalDifficulty(goal) !== difficulty) {
    return false;
  }
  if (terms.length === 0) return true;
  const haystack = getGoalSearchText(goal);
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

/* ── TagInput ────────────────────────────────────────────────────── */

function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
  onTagClick,
  tagClickTitle,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder: string;
  onTagClick?: (tag: string) => void;
  tagClickTitle?: string;
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
            <button
              type="button"
              className="tag-input-tag-label"
              title={tagClickTitle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTagClick?.(g)}
            >
              {g}
            </button>
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
          title={placeholder}
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

/** Per-language variant values, edited in the translate tab. */
function VariantTranslateValues({
  goal,
  target,
  onChange,
  t,
}: {
  goal: GoalItem;
  target: Lang;
  onChange: (vi: number, key: string, value: string) => void;
  t: Translations;
}) {
  const variants = getGoalVariants(goal);
  const placeholders = listPlaceholders(getGoalText(goal));
  if (variants.length === 0 || placeholders.length === 0) return null;
  return (
    <div className="ge-translate-variants">
      <span className="ge-translate-variants-label">
        {t["editor.variants"]}
      </span>
      {variants.map((v, vi) => {
        const label =
          Object.values(v.values ?? {})
            .filter((s) => s.trim() !== "")
            .join(" / ") || String(vi + 1);
        return (
          <div key={vi} className="ge-translate-variant-row">
            <span className="ge-translate-variant-index" title={label}>
              {label}
            </span>
            {placeholders.map((p) => (
              <input
                key={p.key}
                className="ge-translate-variant-input"
                type="text"
                value={v.values_i18n?.[target]?.[p.key] ?? ""}
                placeholder={v.values[p.key]?.trim() ? v.values[p.key] : p.key}
                title={p.key}
                onChange={(e) => onChange(vi, p.key, e.target.value)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
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
  /** Virtualization state owned by GoalEditor so scroll survives tab switches. */
  virtual: VirtualListResult;
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
  virtual: {
    containerRef,
    onScroll,
    registerRowEl,
    virtualStart,
    virtualEnd,
    spacerTop,
    spacerBottom,
  },
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

  const updateVariantValues = (
    index: number,
    vi: number,
    key: string,
    value: string,
  ) => {
    const next = [...goals];
    const item = next[index];
    if (typeof item === "string") return;
    const variants = item.variants ?? [];
    const variant = variants[vi];
    if (!variant) return;
    const langValues = {
      ...(variant.values_i18n?.[target] ?? {}),
      [key]: value,
    };
    const nextI18n = { ...(variant.values_i18n ?? {}) };
    if (Object.values(langValues).every((s) => s === "")) {
      delete nextI18n[target];
    } else {
      nextI18n[target] = langValues;
    }
    const updatedVariants = variants.map((v, i) => {
      if (i !== vi) return v;
      const nv: VariantDef = { ...v };
      if (Object.keys(nextI18n).length > 0) nv.values_i18n = nextI18n;
      else delete nv.values_i18n;
      return nv;
    });
    next[index] = { ...item, variants: updatedVariants };
    onChange(next);
  };

  return (
    <>
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

      <div className="ge-translate-list" ref={containerRef} onScroll={onScroll}>
        {goals.length > 0 && (
          <>
            <div
              className="ge-list-spacer"
              style={{ height: spacerTop }}
              aria-hidden="true"
            />
            {goals.slice(virtualStart, virtualEnd).map((item, i) => {
              const rowIndex = virtualStart + i;
              return (
                <div
                  key={rowIndex}
                  data-row-index={rowIndex}
                  className="ge-translate-virtual"
                  ref={registerRowEl}
                >
                  <div className="ge-translate-row">
                    <span className="ge-translate-index">{rowIndex + 1}</span>
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
                        onChange={(e) =>
                          updateTranslation(rowIndex, "text", e.target.value)
                        }
                      />
                      <textarea
                        className="ge-translate-tooltip-input"
                        value={getTargetTooltip(item, target)}
                        placeholder={getSourceTooltip(item, source) || ""}
                        onChange={(e) =>
                          updateTranslation(rowIndex, "tooltip", e.target.value)
                        }
                        rows={2}
                      />
                      <VariantTranslateValues
                        goal={item}
                        target={target}
                        onChange={(vi, key, value) =>
                          updateVariantValues(rowIndex, vi, key, value)
                        }
                        t={t}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <div
              className="ge-list-spacer"
              style={{ height: spacerBottom }}
              aria-hidden="true"
            />
          </>
        )}
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
  variants: VariantDef[];
}>;

const EMPTY_STATUS_MAP = new Map<string, UploadStatusInfo>();

// Virtualized list tuning for the visual editor: only rows near the viewport
// are mounted, so pools with 200+ goals stay responsive while editing.
const LIST_ROW_GAP = 8; // must match .ge-item-virtual margin-bottom
const LIST_ROW_ESTIMATE = 190; // estimated collapsed row height (px)
const LIST_OVERSCAN = 5; // extra rows rendered above/below the viewport

interface GoalEditorItemProps {
  index: number;
  goal: GoalItem;
  allGroups: string[];
  allGlobalGroups: string[];
  t: Translations;
  onUpdate: (index: number, patch: GoalPatch) => void;
  onRemove: (index: number) => void;
  onFilterGroup: (group: string) => void;
  uploadQueue: ImageUploadQueue | null;
}

const GoalEditorItem = memo(function GoalEditorItem({
  index,
  goal,
  allGroups,
  allGlobalGroups,
  t,
  onUpdate,
  onRemove,
  onFilterGroup,
  uploadQueue,
}: GoalEditorItemProps) {
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [renamingHash, setRenamingHash] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [variantsOpen, setVariantsOpen] = useState(false);

  const images = getGoalImages(goal);
  const variants = getGoalVariants(goal);
  const placeholders = listPlaceholders(getGoalText(goal));
  const anonymousPlaceholder = hasAnonymousPlaceholder(getGoalText(goal));

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
      // 队列中无记录的图片兜底视为已就绪（如入队前的瞬间、分享链接导入的
      // 无 data 图片）；恢复的图片会在 LandingPage 挂载时静默入队，由队列状态驱动
      allStatuses.get(im.hash) ?? { status: "done" },
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
      if (
        trimmed &&
        trimmed !== images.find((a) => a.hash === hash)?.filename
      ) {
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

  const setVariant = useCallback(
    (vi: number, patch: Partial<VariantDef>) => {
      onUpdate(index, {
        variants: variants.map((v, i) => (i === vi ? { ...v, ...patch } : v)),
      });
    },
    [variants, index, onUpdate],
  );

  const addVariant = useCallback(() => {
    onUpdate(index, {
      variants: [
        ...variants,
        {
          values: Object.fromEntries(placeholders.map((p) => [p.key, ""])),
        },
      ],
    });
  }, [variants, index, onUpdate, placeholders]);

  const removeVariant = useCallback(
    (vi: number) => {
      onUpdate(index, { variants: variants.filter((_, i) => i !== vi) });
    },
    [variants, index, onUpdate],
  );

  return (
    <div className="ge-item">
      <span className="ge-item-index">{index + 1}</span>
      <div className="ge-item-fields">
        <div className="ge-item-row">
          <span className="ge-item-text-wrap">
            <input
              className="ge-item-text"
              type="text"
              value={getGoalText(goal)}
              onChange={(e) =>
                onUpdate(index, { text: e.target.value.replace(/\r?\n/g, " ") })
              }
              placeholder={t["editor.textPlaceholder"]}
              title={t["editor.textPlaceholder"]}
            />
            <button
              type="button"
              className={`ge-variants-toggle${variantsOpen ? " ge-variants-toggle--open" : ""}`}
              onClick={() => setVariantsOpen((v) => !v)}
            >
              {t["editor.variants"]}
              {variants.length > 0 && (
                <span className="ge-variants-count">{variants.length}</span>
              )}
            </button>
          </span>
          <input
            className="ge-item-difficulty"
            type="number"
            min={1}
            max={5}
            title={t["editor.difficulty"]}
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
            title={t["editor.counter"]}
            value={getGoalCounter(goal) || ""}
            onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onUpdate(index, { counter: isNaN(v) ? 0 : Math.max(0, v) });
            }}
            placeholder={t["editor.counter"]}
          />
        </div>
        {variantsOpen && (
          <div className="ge-variants-panel">
            {placeholders.length === 0 ? (
              <p className="ge-variants-hint ge-variants-hint--warn">
                {anonymousPlaceholder
                  ? t["editor.variantsAnonymous"]
                  : t["editor.variantsNoPlaceholder"]}
              </p>
            ) : (
              <>
                {variants.map((v, vi) => (
                  <div key={vi} className="ge-variant-row">
                    {placeholders.map((p) => (
                      <input
                        key={p.key}
                        className="ge-variant-value"
                        type="text"
                        value={v.values[p.key] ?? ""}
                        placeholder={p.key}
                        title={p.key}
                        onChange={(e) => {
                          const values = { ...(v.values ?? {}) };
                          values[p.key] = e.target.value;
                          setVariant(vi, { values });
                        }}
                      />
                    ))}
                    <input
                      className="ge-variant-num"
                      type="number"
                      min={1}
                      max={5}
                      value={v.difficulty ?? ""}
                      placeholder={t["editor.difficulty"]}
                      title={t["editor.difficulty"]}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setVariant(vi, { difficulty: undefined });
                          return;
                        }
                        const n = parseInt(raw, 10);
                        if (isNaN(n) || n < 1 || n > 5) return;
                        setVariant(vi, { difficulty: n });
                      }}
                    />
                    <input
                      className="ge-variant-num"
                      type="number"
                      min={0}
                      value={v.counter ?? ""}
                      placeholder={t["editor.counter"]}
                      title={t["editor.counter"]}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setVariant(vi, { counter: undefined });
                          return;
                        }
                        const n = parseInt(raw, 10);
                        if (isNaN(n) || n < 0) return;
                        setVariant(vi, { counter: n });
                      }}
                    />
                    <button
                      type="button"
                      className="ge-variant-remove"
                      onClick={() => removeVariant(vi)}
                      title={t["editor.variantRemove"]}
                    >
                      x
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ge-add-variant-btn"
                  onClick={addVariant}
                >
                  {t["editor.addVariant"]}
                </button>
              </>
            )}
          </div>
        )}
        <div className="ge-item-meta">
          <textarea
            className="ge-item-tooltip"
            value={getGoalTooltip(goal) || ""}
            onChange={(e) => onUpdate(index, { tooltip: e.target.value })}
            placeholder={t["editor.tooltipPlaceholder"]}
            title={t["editor.tooltipPlaceholder"]}
            rows={2}
          />
        </div>
        <div className="ge-item-meta">
          <TagInput
            value={getGoalGroup(goal)}
            onChange={(v) => onUpdate(index, { group: v })}
            suggestions={allGroups}
            placeholder={t["editor.group"]}
            onTagClick={onFilterGroup}
            tagClickTitle={t["editor.filterByGroup"]}
          />
          <TagInput
            value={getGoalGlobalGroup(goal)}
            onChange={(v) => onUpdate(index, { globalGroup: v })}
            suggestions={allGlobalGroups}
            placeholder={t["editor.globalGroup"]}
            onTagClick={onFilterGroup}
            tagClickTitle={t["editor.filterByGroup"]}
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
                  title={
                    isError
                      ? `${t["editor.imageFailed"]}: ${status?.error ?? ""}`
                      : att.filename
                  }
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
});

interface Props {
  goals: GoalItem[];
  onChange: (goals: GoalItem[]) => void;
  onPoolMetaChange: (meta: PoolMetadata) => void;
  onClose: () => void;
  uploadQueue?: ImageUploadQueue | null;
}

export function GoalEditor({
  goals,
  onChange,
  onPoolMetaChange,
  onClose,
  uploadQueue,
}: Props) {
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
  const [filterText, setFilterText] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");

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

  const filterTerms = useMemo(() => splitFilterTerms(filterText), [filterText]);
  const visibleGoals = useMemo(() => {
    const difficulty = filterDifficulty
      ? parseInt(filterDifficulty, 10)
      : undefined;
    const result: { goal: GoalItem; index: number }[] = [];
    for (let i = 0; i < goals.length; i++) {
      if (goalMatchesFilter(goals[i], filterTerms, difficulty)) {
        result.push({ goal: goals[i], index: i });
      }
    }
    return result;
  }, [goals, filterTerms, filterDifficulty]);

  // Virtualize the visual list: only rows near the viewport are mounted.
  const {
    containerRef: listRef,
    onScroll: handleListScroll,
    registerRowEl,
    resetScroll: resetListScroll,
    virtualStart,
    virtualEnd,
    spacerTop,
    spacerBottom,
  } = useVirtualList(visibleGoals.length, {
    estimate: LIST_ROW_ESTIMATE,
    gap: LIST_ROW_GAP,
    overscan: LIST_OVERSCAN,
    // The list container remounts when switching editor tabs, so re-measure
    // and restore the saved scroll position whenever the mode changes.
    remountKey: editorMode,
  });
  // The translate list uses the same hook, owned here so its scroll position
  // survives tab switches exactly like the visual editor.
  const translateList = useVirtualList(goals.length, {
    estimate: 120,
    gap: 8,
    overscan: 5,
    remountKey: editorMode,
  });
  const filterActive = filterText.trim() !== "" || filterDifficulty !== "";

  const tryApplyJson = (): {
    goals: GoalItem[];
    metadata: PoolMetadata | null;
  } | null => {
    setJsonError("");
    try {
      const parsed = JSON.parse(jsonText);
      return parsePoolJson(parsed, t, format, (msg) => setJsonError(msg));
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

    if (editorMode === "json") {
      const result = tryApplyJson();
      if (!result) return;
      onChange(result.goals);
      if (result.metadata) onPoolMetaChange(result.metadata);
      currentGoals = result.goals;
    }
    const csvReadOnly = currentGoals.some(hasCsvUnsupported);

    if (editorMode === "csv" && !csvReadOnly) {
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
      // JSON 模式只编辑任务（与 CSV 模式对齐）；完整的 { metadata, goals }
      // 文档仍可在粘贴/导入时被接受并应用。
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

  const handleClose = () => {
    if (editorMode === "json") {
      const result = tryApplyJson();
      if (result) {
        onChange(result.goals);
        if (result.metadata) onPoolMetaChange(result.metadata);
      }
    } else if (
      editorMode === "csv" &&
      !goalsRef.current.some(hasCsvUnsupported)
    ) {
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
        text_i18n?: Record<string, string>;
        tooltip_i18n?: Record<string, string>;
        difficulty?: number;
        group?: string | string[];
        globalGroup?: string | string[];
        counter?: number;
        images?: ImageAttachment[];
        variants?: VariantDef[];
      } = { ...base, ...patch };
      // Renaming placeholders in the text must carry existing variant values
      // (and the placeholder names in tooltip/translated templates) over to
      // the new names, otherwise variant data silently disappears.
      if (patch.text !== undefined && patch.text !== base.text) {
        const renameMap = getPlaceholderRenameMap(base.text, patch.text);
        if (renameMap.size > 0) {
          if (merged.variants && merged.variants.length > 0) {
            merged.variants = remapVariantValues(
              merged.variants,
              base.text,
              patch.text,
            );
          }
          merged.tooltip = merged.tooltip
            ? renameTemplateTokens(merged.tooltip, renameMap)
            : undefined;
          if (merged.text_i18n) {
            merged.text_i18n = Object.fromEntries(
              Object.entries(merged.text_i18n).map(([lang, tpl]) => [
                lang,
                renameTemplateTokens(tpl, renameMap),
              ]),
            );
          }
          if (merged.tooltip_i18n) {
            merged.tooltip_i18n = Object.fromEntries(
              Object.entries(merged.tooltip_i18n).map(([lang, tpl]) => [
                lang,
                renameTemplateTokens(tpl, renameMap),
              ]),
            );
          }
        }
      }
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
      if (!merged.variants || merged.variants.length === 0)
        delete merged.variants;
      if (
        !merged.tooltip &&
        merged.difficulty === undefined &&
        !merged.group &&
        !merged.globalGroup &&
        !merged.counter &&
        !merged.images &&
        !merged.variants
      ) {
        next[index] = merged.text;
      } else {
        next[index] = merged as GoalItem;
      }
      onChange(next);
    },
    [onChange],
  );

  const addGoal = useCallback(() => {
    const label = t["editor.defaultGoalLabel"];
    const currentAdd = goalsRef.current;
    resetListScroll();
    setFilterText("");
    setFilterDifficulty("");
    onChange([...currentAdd, `${label} ${currentAdd.length + 1}`]);
    setTimeout(() => {
      if (listRef.current)
        listRef.current.scrollTop = listRef.current.scrollHeight;
    }, 50);
  }, [onChange, t, resetListScroll, listRef]);

  const handleFilterGroup = useCallback(
    (group: string) => {
      const quoted = quoteFilterTerm(group);
      resetListScroll();
      setFilterText((prev) => {
        const terms = splitFilterTerms(prev);
        const existing = terms.find(
          (term) => term.toLowerCase() === group.toLowerCase(),
        );
        if (existing !== undefined) {
          return terms
            .filter((term) => term !== existing)
            .map(quoteFilterTerm)
            .join(" ");
        }
        const head = prev.trim();
        return head ? `${head} ${quoted}` : quoted;
      });
    },
    [resetListScroll],
  );

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
            virtual={translateList}
          />
        )}
        {editorMode === "visual" && (
          <>
            <div className="ge-filter-bar">
              <input
                className="ge-filter-text"
                type="text"
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value);
                  resetListScroll();
                }}
                placeholder={t["editor.filterPlaceholder"]}
                title={t["editor.filterPlaceholder"]}
              />
              <select
                className="ge-filter-difficulty"
                value={filterDifficulty}
                onChange={(e) => {
                  setFilterDifficulty(e.target.value);
                  resetListScroll();
                }}
                title={t["editor.difficulty"]}
              >
                <option value="">{t["editor.filterAllDifficulties"]}</option>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
              {filterActive && (
                <>
                  <span className="ge-filter-count">
                    {format(
                      t["editor.filterCount"],
                      visibleGoals.length,
                      goals.length,
                    )}
                  </span>
                  <button
                    type="button"
                    className="ge-filter-clear"
                    onClick={() => {
                      setFilterText("");
                      setFilterDifficulty("");
                      resetListScroll();
                    }}
                  >
                    {t["editor.clearFilter"]}
                  </button>
                </>
              )}
            </div>
            <div
              className="goal-editor-list"
              ref={listRef}
              onScroll={handleListScroll}
            >
              {visibleGoals.length === 0 && (
                <p className="goal-editor-empty">
                  {goals.length === 0
                    ? t["editor.empty"]
                    : t["editor.filterNoMatch"]}
                </p>
              )}
              {visibleGoals.length > 0 && (
                <>
                  <div
                    className="ge-list-spacer"
                    style={{ height: spacerTop }}
                    aria-hidden="true"
                  />
                  {visibleGoals
                    .slice(virtualStart, virtualEnd)
                    .map(({ goal, index }, i) => (
                      <div
                        key={index}
                        data-row-index={virtualStart + i}
                        className="ge-item-virtual"
                        ref={registerRowEl}
                      >
                        <GoalEditorItem
                          index={index}
                          goal={goal}
                          allGroups={allGroups}
                          allGlobalGroups={allGlobalGroups}
                          t={t}
                          onUpdate={updateGoal}
                          onRemove={removeGoal}
                          onFilterGroup={handleFilterGroup}
                          uploadQueue={uploadQueue ?? null}
                        />
                      </div>
                    ))}
                  <div
                    className="ge-list-spacer"
                    style={{ height: spacerBottom }}
                    aria-hidden="true"
                  />
                </>
              )}
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
