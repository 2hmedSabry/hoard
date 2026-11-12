import { t as tr, count as countWord } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { flattenFolders } from "../api";
import { is as isKey } from "../shortcuts";
import type { Folder, Kind, Query, SmartFolder, Sort } from "../types";

type Props = {
  query: Query; setQuery: (f: (q: Query) => Query) => void; thumbSize: number; setThumbSize: (n: number) => void;
  onImport: (dirs: boolean) => void; count: number; selectedCount: number; folders: Folder[]; smartFolders: SmartFolder[];
};

const KINDS: [Kind, string][] = [["image", "Images"], ["video", "Video"], ["audio", "Audio"], ["document", "Docs"], ["font", "Fonts"], ["other", "Other"]];
const SORTS: [Sort, string][] = [
  ["created_desc", "Newest added"], ["created_asc", "Oldest added"], ["modified_desc", "Recently edited"],
  ["name_asc", "Name A–Z"], ["name_desc", "Name Z–A"], ["size_desc", "Largest"], ["size_asc", "Smallest"], ["rating_desc", "Rating"],
];
const SWATCHES = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d6e63", "#1c1c1c", "#8b8d98", "#ffffff"];

export default function Toolbar({ query, setQuery, thumbSize, setThumbSize, onImport, count, selectedCount, folders, smartFolders }: Props) {
  const [colorOpen, setColorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = () => { setColorOpen(false); setImportOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (isKey(e, "search")) { e.preventDefault(); search.current?.focus(); search.current?.select(); }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", key); };
  }, []);

  const toggleKind = (k: Kind) => setQuery((q) => ({ ...q, kinds: q.kinds.includes(k) ? q.kinds.filter((x) => x !== k) : [...q.kinds, k] }));
  const folderName = query.folderId ? flattenFolders(folders).find((x) => x.f.id === query.folderId)?.f.name : null;
  const smartName = query.smartFolderId ? smartFolders.find((s) => s.id === query.smartFolderId)?.name : null;
  const title = { all: "All items", uncategorized: "Uncategorized", untagged: "Untagged", trash: "Trash", folder: folderName ?? "Folder", smart: smartName ?? "Smart folder", duplicates: "Duplicates", similar: "Similar items" }[query.scope];
  const filtered = query.tags.length || query.kinds.length || query.minRating || query.color || query.text;

  return (
    <header className="toolbar">
      <div className="row">
        <div className="title">
          <h2>{query.scope === "folder" || query.scope === "smart" ? title : tr(title)}</h2>
          <span className="muted">{countWord(count, "1 item", "{n} items")}{selectedCount ? " · " + tr("{n} selected", { n: selectedCount }) : ""}</span>
        </div>
        <div className="search">
          <span className="muted">⌕</span>
          <input ref={search} placeholder={tr("Search names, tags, notes, links (⌘F)")} value={query.text}
            onChange={(e) => setQuery((q) => ({ ...q, text: e.target.value }))}
            onKeyDown={(e) => e.key === "Escape" && setQuery((q) => ({ ...q, text: "" }))} />
        </div>
        <input type="range" min={100} max={360} value={thumbSize} title={tr("Thumbnail size")}
          onChange={(e) => setThumbSize(Number(e.target.value))} />
        <div className="popover-wrap">
          <button className="primary" onClick={(e) => { e.stopPropagation(); setImportOpen(!importOpen); }}>{tr("Import")} ⌄</button>
          {importOpen && (
            <div className="menu right" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setImportOpen(false); onImport(false); }}>{tr("Files…")}</button>
              <button onClick={() => { setImportOpen(false); onImport(true); }}>{tr("Folders…")}</button>
              <p className="muted small pad">{tr("Or drop files anywhere in the window.")}</p>
            </div>
          )}
        </div>
      </div>
      <div className="row filters">
        {KINDS.map(([k, label]) => (
          <button key={k} className={`chip${query.kinds.includes(k) ? " on" : ""}`} onClick={() => toggleKind(k)}>{tr(label)}</button>
        ))}
        <span className="sep" />
        <select value={query.minRating} onChange={(e) => setQuery((q) => ({ ...q, minRating: Number(e.target.value) }))}>
          <option value={0}>{tr("Any rating")}</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)}{n < 5 ? " " + tr("or more") : ""}</option>)}
        </select>
        <div className="popover-wrap">
          <button className={`chip${query.color ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); setColorOpen(!colorOpen); }}>
            {query.color && <span className="dot" style={{ background: query.color }} />}{tr("Colour")}
          </button>
          {colorOpen && (
            <div className="menu colors" onClick={(e) => e.stopPropagation()}>
              <div className="swatch-grid">
                {SWATCHES.map((c) => (
                  <button key={c} className={`swatch${query.color === c ? " on" : ""}`} style={{ background: c }}
                    onClick={() => { setQuery((q) => ({ ...q, color: c })); setColorOpen(false); }} />
                ))}
              </div>
              <label className="custom-color">{tr("Custom")} <input type="color" value={query.color ?? "#0090ff"}
                onChange={(e) => setQuery((q) => ({ ...q, color: e.target.value }))} /></label>
              {query.color && <button className="link" onClick={() => { setQuery((q) => ({ ...q, color: null })); setColorOpen(false); }}>{tr("Clear colour")}</button>}
            </div>
          )}
        </div>
        {query.tags.map((t) => (
          <button key={t} className="chip on" title={tr("Remove tag filter")} onClick={() => setQuery((q) => ({ ...q, tags: q.tags.filter((x) => x !== t) }))}>#{t} ×</button>
        ))}
        {filtered ? <button className="link" onClick={() => setQuery((q) => ({ ...q, tags: [], kinds: [], minRating: 0, color: null, text: "" }))}>{tr("Clear filters")}</button> : null}
        <span className="grow" />
        <select value={query.sort} onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value as Sort }))}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
        </select>
      </div>
    </header>
  );
}
