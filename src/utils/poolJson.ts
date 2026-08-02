import type { GoalItem, ImageAttachment, PoolMetadata } from "../types";
import type { Translations } from "../i18n/types";

export function attachmentToJson({
  hash,
  filename,
  mimeType,
  data,
}: ImageAttachment): Record<string, unknown> {
  return { hash, filename, mimeType, ...(data ? { data } : {}) };
}

/** Strip characters that are illegal in file names and cap the length. */
export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(name.replace(/[\\/:*?"<>|]/g, "-"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  return (cleaned || "goal-pool").slice(0, 120);
}

export function goalToJson(item: GoalItem): unknown {
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
    obj.images = item.images.map(attachmentToJson);
  return obj;
}

export function poolToJson(meta: PoolMetadata): Record<string, unknown> {
  const obj: Record<string, unknown> = { name: meta.name };
  if (meta.description) obj.description = meta.description;
  if (meta.images && meta.images.length > 0)
    obj.images = meta.images.map(attachmentToJson);
  return obj;
}

/** The JSON pool document: { metadata, goals }. */
export function poolToDocument(
  meta: PoolMetadata,
  goals: GoalItem[],
): Record<string, unknown> {
  return { metadata: poolToJson(meta), goals: goals.map(goalToJson) };
}

export function normalizeGoalItem(item: GoalItem): GoalItem {
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

const HASH_RE = /^[a-f0-9]{64}$/;

export function isValidImageAttachment(
  value: unknown,
): value is ImageAttachment {
  if (!value || typeof value !== "object") return false;
  const img = value as Record<string, unknown>;
  return (
    typeof img.hash === "string" &&
    HASH_RE.test(img.hash) &&
    typeof img.filename === "string" &&
    typeof img.mimeType === "string" &&
    (img.data === undefined || typeof img.data === "string")
  );
}

export function isValidImageAttachments(
  value: unknown,
): value is ImageAttachment[] {
  return Array.isArray(value) && value.every(isValidImageAttachment);
}

export function isValidPoolMetadata(value: unknown): value is PoolMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  if (typeof meta.name !== "string" || !meta.name.trim()) return false;
  if (
    meta.description !== undefined &&
    meta.description !== null &&
    typeof meta.description !== "string"
  )
    return false;
  if (
    meta.images !== undefined &&
    meta.images !== null &&
    !isValidImageAttachments(meta.images)
  )
    return false;
  return true;
}

export function isValidGoalItem(item: unknown): item is GoalItem {
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
    if (imgs !== undefined && imgs !== null && !isValidImageAttachments(imgs))
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

type PoolJsonFormat = (
  template: string,
  ...args: (string | number)[]
) => string;

/**
 * Parse a JSON pool document. Accepts the new { metadata, goals } object
 * format as well as legacy bare goal arrays (metadata is left untouched).
 */
export function parsePoolJson(
  parsed: unknown,
  t: Translations,
  fmt: PoolJsonFormat,
  onError: (msg: string) => void,
): { goals: GoalItem[]; metadata: PoolMetadata | null } | null {
  let rawGoals: unknown;
  let metadata: PoolMetadata | null = null;
  if (Array.isArray(parsed)) {
    rawGoals = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (obj.metadata !== undefined && obj.metadata !== null) {
      if (!isValidPoolMetadata(obj.metadata)) {
        onError(t["editor.jsonInvalidMetadata"]);
        return null;
      }
      metadata = obj.metadata as PoolMetadata;
    }
    rawGoals = obj.goals;
    if (!Array.isArray(rawGoals)) {
      onError(t["editor.jsonNotArray"]);
      return null;
    }
  } else {
    onError(t["editor.jsonNotArray"]);
    return null;
  }

  const goals = rawGoals as unknown[];
  const items: GoalItem[] = [];
  for (let i = 0; i < goals.length; i++) {
    const raw = goals[i];
    if (!isValidGoalItem(raw)) {
      onError(fmt(t["editor.jsonInvalidItem"], i + 1));
      return null;
    }
    const item = normalizeGoalItem(raw);
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
        ...(item.globalGroup && { globalGroup: cleanGroup(item.globalGroup) }),
      });
    }
  }
  return { goals: items, metadata };
}
