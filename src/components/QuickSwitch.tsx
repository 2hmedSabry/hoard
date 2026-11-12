import { I } from "../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { flattenFolders } from "../api";
import { t as tr } from "../i18n";
import type { LibraryInfo, Query, Scope, Stats } from "../types";

type Entry = { key: string; label: string; hint: string; icon: string; go: (q: Query) => Query };

type Props = { lib: LibraryInfo; stats: Stats | null; setQuery: (f: (q: Query) => Query) => void; onClose: () => void };

/** ⌘K: jump to any view, folder, smart folder or tag by typing. */
export default function QuickSwitch({ lib, stats, setQuery, onClose }: Props) {
  const [text, setText] = useState("");
  const [pos, setPos] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const scope = (s: Scope) => (q: Query): Query => ({ ...q, scope: s, folderId: null, smartFolderId: null });
    const views: [Scope, string, string][] = [["all", "All items", "◫"], ["uncategorized", "Uncategorized", "◌"], ["untagged", "Untagged", "#"], ["duplicates", "Duplicates", "⧉"], ["trash", "Trash", "⌫"]];
    const pathOf = new Map<string, string>();
    const walk = (fs: LibraryInfo["meta"]["folders"], prefix: string) => fs.forEach((f) => { pathOf.set(f.id, prefix + f.name); walk(f.children, prefix + f.name + " / "); });
    walk(lib.meta.folders, "");
    return [
      ...views.map(([s, l, i]) => ({ key: "v:" + s, label: tr(l), hint: tr("View"), icon: i, go: scope(s) })),
      ...flattenFolders(lib.meta.folders).map(({ f }) => ({
        key: "f:" + f.id, label: pathOf.get(f.id) ?? f.name, hint: tr("Folder"), icon: "▢",
        go: (q: Query): Query => ({ ...q, scope: "folder", folderId: f.id, smartFolderId: null }),
      })),
      ...lib.meta.smartFolders.map((sf) => ({
        key: "s:" + sf.id, label: sf.name, hint: tr("Smart folder"), icon: "✦",
        go: (q: Query): Query => ({ ...q, scope: "smart", smartFolderId: sf.id, folderId: null }),
      })),
      ...(stats?.tags ?? []).map(([t]) => ({
        key: "t:" + t, label: t, hint: tr("Tag"), icon: "#",
        go: (q: Query): Query => ({ ...q, scope: "all", folderId: null, smartFolderId: null, tags: [t] }),
      })),
    ];
  }, [lib, stats]);

  const shown = useMemo(() => {
    const w = text.trim().toLowerCase();
    if (!w) return entries.slice(0, 60);
    const starts = entries.filter((e) => e.label.toLowerCase().startsWith(w));
    const has = entries.filter((e) => !e.label.toLowerCase().startsWith(w) && e.label.toLowerCase().includes(w));
    return [...starts, ...has].slice(0, 60);
  }, [entries, text]);

  useEffect(() => setPos(0), [text]);
  useEffect(() => { list.current?.children[pos]?.scrollIntoView({ block: "nearest" }); }, [pos]);

  const pick = (e: Entry | undefined) => { if (!e) return; setQuery(e.go); onClose(); };

  return (
    <div className="modal-back top" onMouseDown={onClose}>
      <div className="switcher" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder={tr("Go to folder, tag or view…")} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setPos((p) => Math.min(shown.length - 1, p + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setPos((p) => Math.max(0, p - 1)); }
            else if (e.key === "Enter") pick(shown[pos]);
            else if (e.key === "Escape") onClose();
          }} />
        <div className="switch-list" ref={list}>
          {shown.map((e, i) => (
            <div key={e.key} className={`switch-row${i === pos ? " on" : ""}`} onMouseEnter={() => setPos(i)} onClick={() => pick(e)}>
              <span className="icon"><I g={e.icon} /></span><span className="label">{e.label}</span><span className="muted small">{e.hint}</span>
            </div>
          ))}
          {!shown.length && <p className="muted pad">{tr("Nothing found.")}</p>}
        </div>
      </div>
    </div>
  );
}
