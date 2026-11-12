export type ThemePref = "dark" | "light" | "system";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "system" ? v : "dark";
  } catch { return "dark"; }
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(pref: ThemePref) {
  try { localStorage.setItem("theme", pref); } catch { /* ignore */ }
  apply(pref);
}

export function initTheme() {
  apply(getTheme());
  media.addEventListener("change", () => { if (getTheme() === "system") apply("system"); });
}
