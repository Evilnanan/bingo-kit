import type { Translations, LangDescriptor } from "./types";
import { en, enDesc } from "./languages/en";
import { zh, zhDesc } from "./languages/zh-CN";

export const langRegistry = [
  { ...enDesc, translations: en },
  { ...zhDesc, translations: zh },
] as const;

export type Lang = (typeof langRegistry)[number]["code"];

export const translations: Record<Lang, Translations> = { en, "zh-CN": zh };
export const langDescriptors: Record<Lang, LangDescriptor> = {
  en: enDesc,
  "zh-CN": zhDesc,
};
export const langCodes: Lang[] = ["en", "zh-CN"];
