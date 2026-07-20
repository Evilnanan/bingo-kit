import { useState, useEffect, type ReactNode } from "react";
import { type Lang, translations, langCodes } from "./translations";
import { I18nCtx } from "./context";

const LS_KEY = "bingo-lang";

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && (langCodes as readonly string[]).includes(v)) return v as Lang;
  } catch {
    /* noop */
  }
  for (const lc of langCodes) {
    if (navigator.language.startsWith(lc)) return lc;
  }
  return langCodes[0];
}

function applyHtmlLang(lang: Lang) {
  document.documentElement.lang = lang;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    applyHtmlLang(lang);
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {
      /* noop */
    }
  };

  const t = translations[lang];

  return (
    <I18nCtx.Provider value={{ lang, t, setLang }}>{children}</I18nCtx.Provider>
  );
}
