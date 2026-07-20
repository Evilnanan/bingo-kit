import { createContext } from "react";
import type { Lang } from "./translations";
import type { Translations } from "./types";

export interface Ctx {
  lang: Lang;
  t: Translations;
  setLang: (l: Lang) => void;
}

export const I18nCtx = createContext<Ctx | null>(null);
