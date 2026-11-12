import { t as tr, useLang } from "./i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import type { ImportProgress, Item, ItemPatch, LibraryInfo, Query, Stats } from "./types";
import Welcome from "./components/Welcome";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import Grid from "./components/Grid";
import Inspector from "./components/Inspector";
import Preview from "./components/Preview";
import Duplicates from "./components/Duplicates";

const DEFAULT_QUERY: Query = {
  scope: "all", folderId: null, smartFolderId: null, tags: [], kinds: [], minRating: 0, color: null, text: "", sort: "created_desc",
};

function readThumbSize() {
  try { return Number(localStorage.getItem("thumbSize")) || 180; } catch { return 180; }
}

export default function App() {
  useLang(); // re-render everything when the language changes
  const [lib, setLib] = useState<LibraryInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(readThumbSize);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);
  const seq = useRef(0);

  const fail = useCallback((e: unknown) => setError(String(e)), []);

  useEffect(() => {
    api.openLastLibrary().then(setLib).catch(fail).finally(() => setBooting(false));
  }, [fail]);

  const refresh = useCallback(async () => {
    if (!lib) return;
    const n = ++seq.current;
    try {
      const [list, st] = await Promise.all([query.scope === "duplicates" ? Promise.resolve([]) : query.scope === "similar" && query.similarTo ? api.similar(query.similarTo) : api.query(query), api.stats()]);
      if (n !== seq.current) return;
      setItems(list);
      setStats(st);
    } catch (e) { fail(e); }
  }, [lib, query, fail]);

  // Typing in search waits a moment; everything else refreshes at once.
  const textRef = useRef(query.text);
  useEffect(() => {
    const typing = textRef.current !== query.text;
    textRef.current = query.text;
    const t = setTimeout(refresh, typing ? 160 : 0);
    return () => clearTimeout(t);
  }, [refresh, query.text]);

  useEffect(() => { try { localStorage.setItem("thumbSize", String(thumbSize)); } catch { /* ignore */ } }, [thumbSize]);

  // Clear selection when switching view.
  useEffect(() => { setSelected(new Set()); setAnchor(null); }, [query.scope, query.folderId, query.smartFolderId, lib?.root]);

  const reloadLib = useCallback(async () => { setLib(await api.libraryInfo()); }, []);

  const importPaths = useCallback(async (paths: string[]) => {
    if (!lib || !paths.length) return;
    const folder = query.scope === "folder" ? query.folderId : null;
    const packs = paths.filter((p) => p.toLowerCase().endsWith(".hoardpack"));
    const rest = paths.filter((p) => !p.toLowerCase().endsWith(".hoardpack"));
    try {
      for (const pk of packs) {
        const [added, skipped] = await api.importPack(pk);
        setNotice(tr("Pack imported: {a} added", { a: added }) + (skipped ? tr(", {s} already in library", { s: skipped }) : ""));
        reloadLib();
      }
      if (rest.length) await api.importPaths(rest, folder);
    } catch (e) { fail(e); }
    finally {
      setTimeout(() => setProgress(null), 1200);
      refresh();
    }
  }, [lib, query.scope, query.folderId, refresh, fail, reloadLib]);

  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const un: Promise<() => void>[] = [
      listen<ImportProgress>("import-progress", (e) => setProgress(e.payload)),
      listen("items-imported", () => refreshRef.current()),
      listen("items-analyzed", () => refreshRef.current()),
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDropping(true);
        else if (p.type === "leave") setDropping(false);
        else if (p.type === "drop") { setDropping(false); importRef.current(p.paths); }
      }),
    ];
    return () => { un.forEach((p) => p.then((f) => f())); };
  }, []);

  const update = useCallback(async (ids: string[], patch: ItemPatch) => {
    try {
      const changed = await api.update(ids, patch);
      const map = new Map(changed.map((c) => [c.id, c]));
      setItems((list) => list.map((i) => map.get(i.id) ?? i));
      api.stats().then(setStats).catch(fail);
      // Folder/tag membership can change what this view shows.
      if (patch.addFolders || patch.removeFolders || patch.addTags || patch.removeTags) refresh();
    } catch (e) { fail(e); }
  }, [refresh, fail]);

  const trash = useCallback(async (ids: string[], trashed: boolean) => {
    if (!ids.length) return;
    try {
      await api.setTrashed(ids, trashed);
      setSelected(new Set());
      refresh();
    } catch (e) { fail(e); }
  }, [refresh, fail]);

  const emptyTrash = useCallback(async () => {
    const ok = await ask("Permanently delete everything in the Trash? This can't be undone.", { title: "Empty Trash", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
    if (!ok) return;
    try { await api.emptyTrash(); refresh(); } catch (e) { fail(e); }
  }, [refresh, fail]);

  const pickImport = useCallback(async (dirs: boolean) => {
    const res = await openDialog({ multiple: true, directory: dirs, title: dirs ? tr("Import folders") : tr("Import files") });
    if (res) importPaths(Array.isArray(res) ? res : [res]);
  }, [importPaths]);

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  const select = useCallback((id: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && anchor) {
      const a = items.findIndex((i) => i.id === anchor), b = items.findIndex((i) => i.id === id);
      if (a >= 0 && b >= 0) {
        const [s, t] = a < b ? [a, b] : [b, a];
        setSelected(new Set(items.slice(s, t + 1).map((i) => i.id)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
    } else {
      setSelected(new Set([id]));
    }
    setAnchor(id);
  }, [anchor, items]);

  // Keyboard shortcuts for the grid.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (previewId || query.scope === "duplicates") return; // Preview and Duplicates handle their own keys.
      if (e.key === " " && selected.size) { e.preventDefault(); setPreviewId([...selected][0]); }
      else if ((e.key === "Backspace" || e.key === "Delete") && selected.size && query.scope !== "trash") { e.preventDefault(); trash([...selected], true); }
      else if (e.key === "a" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSelected(new Set(items.map((i) => i.id))); }
      else if (e.key === "Escape") setSelected(new Set());
      else if (["ArrowLeft", "ArrowRight"].includes(e.key) && items.length) {
        e.preventDefault();
        const cur = items.findIndex((i) => i.id === anchor);
        const next = Math.max(0, Math.min(items.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
        setSelected(new Set([items[next].id])); setAnchor(items[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, anchor, previewId, query.scope, trash]);

  if (booting) return <div className="boot" />;
  if (!lib) return <Welcome onOpen={(l) => { setLib(l); setQuery(DEFAULT_QUERY); }} error={error} setError={setError} />;

  return (
    <div className="app">
      <Sidebar
        lib={lib} stats={stats} query={query} setQuery={setQuery}
        onLibChange={async () => { await reloadLib(); refresh(); }}
        onSwitchLibrary={(l) => { setLib(l); setQuery(DEFAULT_QUERY); }}
        onDropItems={(ids, folderId) => update(ids, { addFolders: [folderId] })}
        onEmptyTrash={emptyTrash} fail={fail}
      />
      <main className="main">
        {query.scope === "duplicates" ? <Duplicates root={lib.root} onChanged={refresh} fail={fail} /> : <>
        <Toolbar query={query} setQuery={setQuery} thumbSize={thumbSize} setThumbSize={setThumbSize}
          onImport={pickImport} count={items.length} selectedCount={selected.size} folders={lib.meta.folders} smartFolders={lib.meta.smartFolders ?? []} />
        <Grid
          root={lib.root} items={items} selected={selected} thumbSize={thumbSize}
          onSelect={select} onClear={() => setSelected(new Set())}
          onOpen={(id) => setPreviewId(id)} emptyHint={query}
        />
        </>}
        {progress && (
          <div className="progress">
            <span>{tr("Importing {d} of {n}", { d: progress.done, n: progress.total })}{progress.skipped ? " · " + tr("{s} already in library", { s: progress.skipped }) : ""}{progress.failed ? " · " + tr("{f} failed", { f: progress.failed }) : ""}</span>
            <div className="bar"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          </div>
        )}
        {dropping && <div className="drop-hint"><div>{query.scope === "folder" ? tr("Drop to import into this folder") : tr("Drop to import")}</div></div>}
      </main>
      <Inspector
        root={lib.root} items={selectedItems} stats={stats} folders={lib.meta.folders}
        inTrash={query.scope === "trash"} total={stats?.all ?? 0}
        onUpdate={update} onTrash={trash} onChanged={refresh} onNotice={setNotice}
        onColor={(c) => setQuery((q) => ({ ...q, color: c }))}
        onSimilar={(id) => setQuery((q) => ({ ...q, scope: "similar", similarTo: id, folderId: null, smartFolderId: null }))}
        onTag={(t) => setQuery((q) => ({ ...q, tags: q.tags.includes(t) ? q.tags : [...q.tags, t] }))}
        onPreview={(id) => setPreviewId(id)} fail={fail}
      />
      {previewId && (
        <Preview root={lib.root} items={items} id={previewId} onNavigate={(id) => { setPreviewId(id); setSelected(new Set([id])); setAnchor(id); }}
          onClose={() => setPreviewId(null)} fail={fail}
          onItemChanged={(it) => { setItems((list) => list.map((i) => (i.id === it.id ? it : i))); }} />
      )}
      {notice && <div className="toast ok" onClick={() => setNotice(null)}><span>{notice}</span></div>}
      {error && (
        <div className="toast" onClick={() => setError(null)}>
          <span>{error}</span><button className="link">{tr("Dismiss")}</button>
        </div>
      )}
    </div>
  );
}
