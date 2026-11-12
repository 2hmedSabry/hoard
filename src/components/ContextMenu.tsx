import { useEffect, useRef } from "react";
import { t as tr } from "../i18n";

export type MenuItem = { label: string; run: () => void; danger?: boolean; disabled?: boolean } | "sep";

/** A right-click menu at the pointer. Arrow keys move, Enter picks, Esc closes. */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    // Keep inside the window.
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
    el.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const close = (e: Event) => { if (!el.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      const btns = [...el.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const i = btns.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => { window.removeEventListener("mousedown", close, true); window.removeEventListener("keydown", key, true); window.removeEventListener("blur", onClose); };
  }, [x, y, onClose]);

  return (
    <div ref={ref} className="menu context-menu" role="menu" aria-label={tr("Actions")} style={{ left: x, top: y }}>
      {items.map((it, i) => it === "sep" ? <div key={i} className="menu-sep" role="separator" /> : (
        <button key={i} role="menuitem" className={it.danger ? "danger" : ""} disabled={it.disabled}
          onClick={() => { onClose(); it.run(); }}>{it.label}</button>
      ))}
    </div>
  );
}
