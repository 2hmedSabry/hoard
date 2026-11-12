// Interface languages. English strings are the keys; other languages map them.
// Use t("Text {n}", { n }) anywhere; components re-render through useLang().
import { useSyncExternalStore } from "react";
import ar from "./locales/ar";

export type Lang = "en" | "ar";
export type LangPref = Lang | "system";
const DICTS: Record<Lang, Record<string, string>> = { en: {}, ar };
export const LANGS: [LangPref, string][] = [["system", "System"], ["en", "English"], ["ar", "العربية"]];
const RTL = new Set<Lang>(["ar"]);

function systemLang(): Lang {
  return (navigator.languages ?? [navigator.language]).some((l) => l.toLowerCase().startsWith("ar")) ? "ar" : "en";
}

function readPref(): LangPref {
  try {
    const v = localStorage.getItem("lang");
    return v === "en" || v === "ar" ? v : "system";
  } catch { return "system"; }
}

let pref: LangPref = readPref();
let lang: Lang = pref === "system" ? systemLang() : pref;
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
}
apply();

export function getLangPref() { return pref; }
export function getLang() { return lang; }

export function setLang(p: LangPref) {
  pref = p;
  lang = p === "system" ? systemLang() : p;
  try { localStorage.setItem("lang", p); } catch { /* ignore */ }
  apply();
  listeners.forEach((l) => l());
}

export function useLang() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
}

export function t(key: string, vars?: Record<string, string | number>) {
  let s = DICTS[lang][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** "1 item" / "5 items" in English; Arabic uses its own forms. */
export function count(n: number, one: string, many: string) {
  if (lang === "ar") {
    const forms = (DICTS.ar[`#${one}`] ?? "").split("|");
    if (forms.length === 4) {
      if (n === 1) return forms[0];
      if (n === 2) return forms[1];
      if (n >= 3 && n <= 10) return forms[2].replace("{n}", String(n));
      return forms[3].replace("{n}", String(n));
    }
  }
  return (n === 1 ? one : many).replace("{n}", String(n));
}
