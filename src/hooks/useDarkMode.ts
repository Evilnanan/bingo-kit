import { useState } from "react";

const KEY = "bingo-theme";
type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* noop */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function useDarkMode() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readTheme();
    applyTheme(t);
    return t;
  });

  const toggle = () => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return { theme, toggle };
}
