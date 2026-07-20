import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT, format } from "../i18n/useT";
import { langCodes, langDescriptors } from "../i18n/translations";
import type { Lang } from "../i18n/translations";
import type { Translations } from "../i18n/types";
import type { GoalItem } from "../types";
import {
  getGoalCounter,
  getGoalDifficulty,
  getGoalGroup,
  getGoalGlobalGroup,
  getGoalText,
  getGoalTooltip,
} from "../types";
import "./GoalEditor.css";

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
  // Append translation columns for all languages
  for (const lc of langCodes) {
    cols.push(item.text_i18n?.[lc] ?? "");
    cols.push(item.tooltip_i18n?.[lc] ?? "");
  }
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

    // Parse translation columns (pairs of text, tooltip for each non-default language)
    let textI18n: Record<string, string> | undefined;
    let tooltipI18n: Record<string, string> | undefined;
    let colIdx = 6;
    for (const lc of langCodes) {
      const tiVal = (cols[colIdx] ?? "").trim();
      if (tiVal) {
        textI18n ??= {};
        textI18n[lc] = tiVal;
      }
      colIdx++;
      const tpiVal = (cols[colIdx] ?? "").trim();
      if (tpiVal) {
        tooltipI18n ??= {};
        tooltipI18n[lc] = tpiVal;
      }
      colIdx++;
    }

    const item = normalizeGoalItem({
      text: textVal,
      ...(tooltip && { tooltip }),
      ...(difficulty !== undefined && { difficulty }),
      ...(group !== undefined && { group }),
      ...(globalGroup !== undefined && { globalGroup }),
      ...(counter !== undefined && { counter }),
      ...(textI18n && { text_i18n: textI18n }),
      ...(tooltipI18n && { tooltip_i18n: tooltipI18n }),
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
  } = item;
  if (
    !tooltip &&
    difficulty === undefined &&
    !group &&
    !globalGroup &&
    !counter &&
    !text_i18n &&
    !tooltip_i18n
  ) {
    return text;
  }
  return item;
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
}>;

interface GoalEditorItemProps {
  index: number;
  goal: GoalItem;
  allGroups: string[];
  allGlobalGroups: string[];
  t: Translations;
  onUpdate: (index: number, patch: GoalPatch) => void;
  onRemove: (index: number) => void;
}

function GoalEditorItem({
  index,
  goal,
  allGroups,
  allGlobalGroups,
  t,
  onUpdate,
  onRemove,
}: GoalEditorItemProps) {
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
      </div>
      <button
        type="button"
        className="ge-item-remove"
        onClick={() => onRemove(index)}
        title={t["editor.remove"]}
      >
        ✕
      </button>
    </div>
  );
}

interface Props {
  goals: GoalItem[];
  onChange: (goals: GoalItem[]) => void;
  onClose: () => void;
}

export function GoalEditor({ goals, onChange, onClose }: Props) {
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
    if (editorMode === "json") {
      const items = tryApplyJson();
      if (!items) return;
      onChange(items);
      currentGoals = items;
    } else if (editorMode === "csv") {
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
      setEditorMode("json");
    } else {
      setCsvText(currentGoals.map(goalToCsv).join("\n"));
      setCsvError("");
      setEditorMode("csv");
    }
  };

  const handleClose = () => {
    if (editorMode === "json") {
      const items = tryApplyJson();
      if (items) onChange(items);
    } else if (editorMode === "csv") {
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
      if (
        !merged.tooltip &&
        merged.difficulty === undefined &&
        !merged.group &&
        !merged.globalGroup &&
        !merged.counter
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
        </div>

        {editorMode === "json" && (
          <div className="goal-editor-json">
            <LineNumberedTextArea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError("");
              }}
            />
            {jsonError && <p className="ge-json-error">{jsonError}</p>}
          </div>
        )}
        {editorMode === "csv" && (
          <div className="goal-editor-json">
            <p className="ge-json-hint">{t["editor.csvHint"]}</p>
            <LineNumberedTextArea
              value={csvText}
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
