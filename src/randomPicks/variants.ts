import type { GoalItem, VariantDef } from "../types";
import { getGoalVariants } from "../types";

/** A named placeholder token found in a goal template. */
export interface PlaceholderToken {
  /** The placeholder name (text between `{` and `}`). */
  key: string;
  /** Display label, e.g. `{item}`. */
  label: string;
}

const PLACEHOLDER_RE = /\{([^{}]+)\}/g;

/** List distinct named placeholders in a template in first-seen order.
 *  Placeholders must be named (`{name}`); bare `{}` is not a placeholder. */
export function listPlaceholders(text: string): PlaceholderToken[] {
  const seen = new Map<string, string>();
  const result: PlaceholderToken[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const key = m[1].trim();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, `{${key}}`);
      result.push({ key, label: `{${key}}` });
    }
  }
  return result;
}

/** Number of distinct named placeholders in a template. */
export function countPlaceholders(text: string): number {
  return listPlaceholders(text).length;
}

/**
 * Compute an old-key -> new-key rename map between two templates.
 * Keys that still exist by name map to themselves; keys that no longer exist
 * fall back positionally (in order) to the first unused new key, so renaming
 * a placeholder carries existing values over instead of losing them.
 */
export function getPlaceholderRenameMap(
  oldText: string,
  newText: string,
): Map<string, string> {
  const oldP = listPlaceholders(oldText);
  const newP = listPlaceholders(newText);
  const map = new Map<string, string>();
  if (oldP.length === 0 || newP.length === 0) return map;
  const used = new Set<string>();
  for (const o of oldP) {
    if (newP.some((n) => n.key === o.key)) {
      map.set(o.key, o.key);
      used.add(o.key);
    }
  }
  for (const o of oldP) {
    if (map.has(o.key)) continue;
    const candidate = newP.find((n) => !used.has(n.key));
    if (!candidate) break;
    map.set(o.key, candidate.key);
    used.add(candidate.key);
  }
  return map;
}

/**
 * Remap variant values after placeholders changed in a template.
 * - Keys that still exist (by name, or positionally after a rename) keep
 *   their values.
 * - Values whose placeholder was deleted stay in the map as orphans so they
 *   can be restored later.
 * - Newly written placeholders without a value inherit the next orphaned
 *   value in order, so "delete the placeholder, then rewrite it" does not
 *   lose the variant data.
 */
export function remapVariantValues(
  variants: VariantDef[],
  oldText: string,
  newText: string,
): VariantDef[] {
  if (variants.length === 0) return variants;
  const newP = listPlaceholders(newText);
  const map = getPlaceholderRenameMap(oldText, newText);

  function remapValues(values: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const orphans: string[] = [];
    for (const key of Object.keys(values)) {
      const target = map.get(key) ?? key;
      if (newP.some((n) => n.key === target)) {
        out[target] = values[key];
      } else {
        out[key] = values[key];
        orphans.push(key);
      }
    }
    for (const n of newP) {
      if (n.key in out) continue;
      const orphan = orphans.shift();
      if (orphan === undefined) break;
      out[n.key] = out[orphan];
      delete out[orphan];
    }
    return out;
  }

  return variants.map((v) => {
    const next: VariantDef = {
      ...v,
      values: remapValues(v.values),
    };
    if (v.values_i18n) {
      next.values_i18n = Object.fromEntries(
        Object.entries(v.values_i18n).map(([lang, vals]) => [
          lang,
          remapValues(vals),
        ]),
      );
    }
    return next;
  });
}

/** Rename `{oldKey}` tokens to `{newKey}` in a template string. */
export function renameTemplateTokens(
  template: string,
  map: Map<string, string>,
): string {
  let out = template;
  for (const [oldKey, newKey] of map) {
    if (oldKey === newKey) continue;
    out = out.split(`{${oldKey}}`).join(`{${newKey}}`);
  }
  return out;
}

/** True when the template contains bare `{}` (not a supported placeholder). */
export function hasAnonymousPlaceholder(text: string): boolean {
  return /\{\}/.test(text);
}

/** Fill named `{name}` placeholders in `template` with the values map.
 *  Bare `{}` is left untouched. */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_raw, inner: string) => {
    const key = inner.trim();
    return key ? (values[key] ?? "") : _raw;
  });
}

/** Fill every i18n template in `map` (text_i18n / tooltip_i18n). */
function fillI18n(
  map: Record<string, string> | undefined,
  values: Record<string, string>,
  valuesI18n?: Record<string, Record<string, string>>,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const [lang, template] of Object.entries(map)) {
    out[lang] = fillTemplate(template, {
      ...values,
      ...(valuesI18n?.[lang] ?? {}),
    });
  }
  return out;
}

/**
 * Expand a goal pool into concrete goal items:
 * - Goals without variants pass through unchanged.
 * - A goal with N variants becomes N items, one per variant, with the
 *   template text (and translated templates, if any) filled and
 *   difficulty/counter overridden per variant.
 * Each expanded variant carries an internal `variantGroup` id so pick
 * algorithms can keep variants of the same goal mutually exclusive.
 */
export function expandVariants(pool: GoalItem[]): GoalItem[] {
  const out: GoalItem[] = [];
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const variants = getGoalVariants(item);
    if (variants.length === 0) {
      out.push(item);
      continue;
    }
    const base = typeof item === "string" ? { text: item } : item;
    const groupId = `vg-${i}`;
    for (const variant of variants) {
      const concrete: GoalItem = {
        ...base,
        text: fillTemplate(base.text, variant.values),
        text_i18n: fillI18n(
          base.text_i18n,
          variant.values,
          variant.values_i18n,
        ),
        tooltip: base.tooltip
          ? fillTemplate(base.tooltip, variant.values)
          : undefined,
        tooltip_i18n: fillI18n(
          base.tooltip_i18n,
          variant.values,
          variant.values_i18n,
        ),
        variantGroup: groupId,
      };
      delete concrete.variants;
      if (variant.difficulty !== undefined) {
        concrete.difficulty = variant.difficulty;
      } else if (concrete.difficulty === undefined) {
        delete concrete.difficulty;
      }
      if (variant.counter !== undefined) {
        concrete.counter = variant.counter;
      } else if (concrete.counter === undefined) {
        delete concrete.counter;
      }
      out.push(concrete);
    }
  }
  return out;
}

/** The internal variant-group id of an item, if it is an expanded variant. */
export function getVariantGroupId(g: GoalItem): string | null {
  return typeof g === "string" ? null : (g.variantGroup ?? null);
}

/** Validate a variant definition: values must be a name -> string map. */
export function isVariantDef(v: unknown): v is VariantDef {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (
    !o.values ||
    typeof o.values !== "object" ||
    Array.isArray(o.values) ||
    !Object.values(o.values).every((s) => typeof s === "string")
  )
    return false;
  const vi = o.values_i18n;
  if (vi !== undefined && vi !== null) {
    if (typeof vi !== "object" || Array.isArray(vi)) return false;
    for (const langValues of Object.values(vi)) {
      if (
        !langValues ||
        typeof langValues !== "object" ||
        Array.isArray(langValues) ||
        !Object.values(langValues).every((s) => typeof s === "string")
      )
        return false;
    }
  }
  const d = o.difficulty;
  if (
    d !== undefined &&
    d !== null &&
    !(typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 5)
  )
    return false;
  const c = o.counter;
  if (
    c !== undefined &&
    c !== null &&
    !(typeof c === "number" && Number.isInteger(c) && c >= 0)
  )
    return false;
  return true;
}
