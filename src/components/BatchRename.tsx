import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import type { Item } from "../types";

type Props = { items: Item[]; onApply: (names: [string, string][]) => void; onClose: () => void };

/** Builds a name from a pattern: {name} {n} {n:3} {ext} {w} {h} {date} {tags}. */
function build(pattern: string, it: Item, n: number) {
  const d = new Date(it.createdAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return pattern.replace(/\{(name|n(?::(\d+))?|ext|w|h|date|tags)\}/g, (_, key: string, pad?: string) => {
    if (key.startsWith("n")) return pad ? String(n).padStart(Number(pad), "0") : String(n);
    return { name: it.name, ext: it.ext, w: String(it.width || ""), h: String(it.height || ""), date, tags: it.tags.join(" ") }[key] ?? "";
  });
}

export default function BatchRename({ items, onApply, onClose }: Props) {
  const [pattern, setPattern] = useState("{name}");
  const [start, setStart] = useState(1);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const result = useMemo(() => items.map((it, i) => {
    let name = build(pattern, it, start + i);
    if (find) name = name.split(find).join(replace);
    return [it.id, name.trim()] as [string, string];
  }), [items, pattern, start, find, replace]);
  const empty = result.some(([, n]) => !n);

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{tr("Rename {n} items", { n: items.length })}</h3>
        <label className="field"><span>{tr("Name pattern")}</span>
          <input autoFocus value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        <div className="token-help muted small">
          {["{name}", "{n}", "{n:3}", "{date}", "{w}", "{h}", "{ext}", "{tags}"].map((t) => (
            <button key={t} className="chip" onClick={() => setPattern((p) => p + t)}>{t}</button>
          ))}
        </div>
        <div className="row-3">
          <label className="field"><span>{tr("Start numbers at")}</span><input type="number" value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} /></label>
          <label className="field"><span>{tr("Find")}</span><input value={find} onChange={(e) => setFind(e.target.value)} /></label>
          <label className="field"><span>{tr("Replace with")}</span><input value={replace} onChange={(e) => setReplace(e.target.value)} /></label>
        </div>
        <div className="rename-preview">
          {result.slice(0, 8).map(([id, n], i) => (
            <div key={id}><span className="muted">{items[i].name}</span><span>→</span><b>{n || tr("(empty)")}</b></div>
          ))}
          {items.length > 8 && <div className="muted small">{tr("…and {n} more", { n: items.length - 8 })}</div>}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{tr("Cancel")}</button>
          <button className="primary" disabled={empty} onClick={() => onApply(result)}>{tr("Rename")}</button>
        </div>
      </div>
    </div>
  );
}
