// Keyboard shortcuts that people can change. Stored per computer.
export type Action = "preview" | "open" | "trash" | "selectAll" | "clear" | "next" | "prev" | "up" | "down" | "first" | "last" | "rename" | "zoomIn" | "zoomOut" | "search" | "quickSwitch" | "import" | "slideshow";

export const DEFAULTS: Record<Action, string> = {
  preview: "Space",
  open: "Enter",
  trash: "Backspace",
  selectAll: "Mod+A",
  clear: "Escape",
  next: "ArrowRight",
  prev: "ArrowLeft",
  up: "ArrowUp",
  down: "ArrowDown",
  first: "Home",
  last: "End",
  rename: "F2",
  zoomIn: "Mod+=",
  zoomOut: "Mod+-",
  search: "Mod+F",
  quickSwitch: "Mod+K",
  import: "Mod+I",
  slideshow: "P",
};

export const LABELS: Record<Action, string> = {
  preview: "Preview selected item",
  open: "Open preview",
  trash: "Move to Trash",
  selectAll: "Select all",
  clear: "Clear selection",
  next: "Next item",
  prev: "Previous item",
  up: "Item above",
  down: "Item below",
  first: "First item",
  last: "Last item",
  rename: "Rename item",
  zoomIn: "Bigger thumbnails",
  zoomOut: "Smaller thumbnails",
  search: "Search",
  quickSwitch: "Go to folder or tag",
  import: "Import files",
  slideshow: "Slideshow (in preview)",
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** "Mod+Shift+K" style name for a key press. Mod is ⌘ on Mac and Ctrl elsewhere. */
export function comboOf(e: KeyboardEvent): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key === " " ? "Space" : e.key;
  if (key === "Delete") key = "Backspace"; // treat both delete keys alike
  if (key.length === 1) key = key.toUpperCase();
  if (key === "+") key = "="; // ⌘+ and ⌘= are the same key
  parts.push(key);
  return parts.join("+");
}

export function pretty(combo: string): string {
  return combo.split("+").map((p) => ({ Mod: isMac ? "⌘" : "Ctrl", Ctrl: "⌃", Alt: isMac ? "⌥" : "Alt", Shift: isMac ? "⇧" : "Shift", ArrowRight: "→", ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", Backspace: "⌫", Escape: "Esc" } as Record<string, string>)[p] ?? p).join(isMac ? "" : "+");
}

function load(): Record<Action, string> {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("shortcuts") || "{}") }; } catch { return { ...DEFAULTS }; }
}

let map = load();
export function getShortcuts() { return map; }
export function setShortcut(a: Action, combo: string) {
  map = { ...map, [a]: combo };
  try { localStorage.setItem("shortcuts", JSON.stringify(map)); } catch { /* ignore */ }
}
export function resetShortcuts() {
  map = { ...DEFAULTS };
  try { localStorage.removeItem("shortcuts"); } catch { /* ignore */ }
}
export function is(e: KeyboardEvent, a: Action) {
  return comboOf(e) === map[a];
}

/** Same as is(), but also true with Shift held (used to extend a selection). */
export function isWithShift(e: KeyboardEvent, a: Action) {
  const c = comboOf(e);
  return c === map[a] || (e.shiftKey && c === `Shift+${map[a]}`) || (e.shiftKey && c?.replace("Shift+", "") === map[a]);
}
