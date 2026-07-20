import { useContext } from "react";
import { I18nCtx } from "./context";

export function useT() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}

export function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, idx: string) => String(args[+idx]));
}
