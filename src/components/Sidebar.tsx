import { useEffect, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { beginDrag, type DropDetail } from "../drag";
import type { Folder, LibraryInfo, Query, Rule, Scope, SmartFolder, Stats } from "../types";
import SmartFolderEditor from "./SmartFolderEditor";
import BrowserConnect from "./BrowserConnect";
import WatchedFolders from "./WatchedFolders";
import { getTheme, setTheme, type ThemePref } from "../theme";
import InlineEdit from "./InlineEdit";

type Props = {
  lib: LibraryInfo; stats: Stats | null; query: Query; setQuery: (f: (q: Query) => Query) => void;
  onLibChange: () => void; onSwitchLibrary: (l: LibraryInfo) => void;
  onDropItems: (ids: string[], folderId: string) => void; onEmptyTrash: () => void; fail: (e: unknown) => void;
};

type Editing = { kind: "new"; parent: string | null } | { kind: "rename"; id: string } | { kind: "tag"; tag: string } | { kind: "library" } | null;

function useExpanded() {
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("expanded") || "[]")); } catch { return new Set(); }
  });
  useEffect(() => { try { localStorage.setItem("expanded", JSON.stringify([...open])); } catch { /* ignore */ } }, [open]);
  const toggle = (id: string, force?: boolean) =>
    setOpen((s) => { const n = new Set(s); (force ?? !n.has(id)) ? n.add(id) : n.delete(id); return n; });
  return { open, toggle };
}

export default function Sidebar(p: Props) {
  const { lib, stats, query, setQuery, fail } = p;
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [libMenu, setLibMenu] = useState(false);
  const [connect, setConnect] = useState(false);
  const [watching, setWatching] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getTheme);
  const [smartEdit, setSmartEdit] = useState<SmartFolder | "new" | null>(null);
  const { open, toggle } = useExpanded();

  useEffect(() => {
    const close = () => { setMenu(null); setLibMenu(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const go = (scope: Scope, id: string | null = null) =>
    setQuery((q) => ({ ...q, scope, folderId: scope === "folder" ? id : null, smartFolderId: scope === "smart" ? id : null }));
  const active = (scope: Scope, id: string | null = null) =>
    query.scope === scope && (scope === "folder" ? query.folderId === id : scope === "smart" ? query.smartFolderId === id : true);

  const run = async (f: () => Promise<unknown>) => { try { await f(); p.onLibChange(); } catch (e) { fail(e); } };

  const switchLibrary = async () => {
    const path = await openDialog({ directory: true, title: "Open a .hoard library" });
    if (typeof path === "string") api.openLibrary(path).then(p.onSwitchLibrary).catch(fail);
  };
  const newLibrary = async (name: string) => {
    const parent = await openDialog({ directory: true, title: "Choose where to save the library" });
    if (typeof parent === "string") api.createLibrary(parent, name).then(p.onSwitchLibrary).catch(fail);
  };

  const onDropRef = { current: (d: DropDetail) => {
    const folderId = d.target === "__top" ? null : d.target;
    if (d.payload.kind === "items" && folderId) p.onDropItems(d.payload.ids, folderId);
    else if (d.payload.kind === "folder") run(() => api.moveFolder((d.payload as { id: string }).id, folderId)).then(() => folderId && toggle(folderId, true));
  } };
  useEffect(() => {
    const h = (e: Event) => onDropRef.current((e as CustomEvent<DropDetail>).detail);
    window.addEventListener("hoard-drop", h);
    return () => window.removeEventListener("hoard-drop", h);
  });

  const row = (label: string, scope: Scope, count?: number, icon?: string) => (
    <button className={`nav-row${active(scope) ? " active" : ""}`} onClick={() => go(scope)}>
      <span className="icon">{icon}</span><span className="label">{label}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  const renderFolder = (f: Folder, depth: number): React.ReactNode => {
    const isOpen = open.has(f.id);
    return (
      <div key={f.id}>
        <div
          className={`nav-row folder${active("folder", f.id) ? " active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }} data-drop={f.id}
          onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input, .more, .twisty, .menu")) beginDrag(e, () => ({ kind: "folder", id: f.id }), () => f.name); }}
          onClick={() => go("folder", f.id)}
          onDoubleClick={() => setEditing({ kind: "rename", id: f.id })}
        >
          <span className={`twisty${f.children.length ? "" : " empty"}${isOpen ? " open" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>▸</span>
          <span className="icon">▢</span>
          {editing?.kind === "rename" && editing.id === f.id ? (
            <InlineEdit initial={f.name} onDone={(v) => { setEditing(null); if (v && v !== f.name) run(() => api.renameFolder(f.id, v)); }} />
          ) : <span className="label">{f.name}</span>}
          <span className="count">{stats?.folders[f.id] ?? ""}</span>
          <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === f.id ? null : f.id); }}>⋯</span>
          {menu === f.id && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenu(null); toggle(f.id, true); setEditing({ kind: "new", parent: f.id }); }}>New subfolder</button>
              <button onClick={() => { setMenu(null); setEditing({ kind: "rename", id: f.id }); }}>Rename</button>
              {depth > 0 && <button onClick={() => { setMenu(null); run(() => api.moveFolder(f.id, null)); }}>Move to top level</button>}
              <button className="danger" onClick={async () => {
                setMenu(null);
                const ok = await ask(`Delete the folder "${f.name}" and its subfolders? The items stay in your library.`, { title: "Delete folder", kind: "warning", okLabel: "Delete" });
                if (ok) { if (active("folder", f.id)) go("all"); run(() => api.deleteFolder(f.id)); }
              }}>Delete folder</button>
            </div>
          )}
        </div>
        {isOpen && f.children.map((c) => renderFolder(c, depth + 1))}
        {isOpen && editing?.kind === "new" && editing.parent === f.id && (
          <div className="nav-row" style={{ paddingLeft: 8 + (depth + 1) * 14 + 16 }}>
            <InlineEdit initial="" placeholder="Folder name" onDone={(v) => { setEditing(null); if (v) run(() => api.createFolder(v, f.id)); }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="lib-header" onClick={(e) => { e.stopPropagation(); setLibMenu(!libMenu); }}>
        <div className="logo small" />
        {editing?.kind === "library" ? (
          <InlineEdit initial="" placeholder="New library name" onDone={(v) => { setEditing(null); if (v) newLibrary(v); }} />
        ) : (
          <>
            <div className="lib-name" title={lib.root}>{lib.meta.name}</div>
            <span className="chev">⌄</span>
          </>
        )}
        {libMenu && (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setLibMenu(false); switchLibrary(); }}>Open library…</button>
            <button onClick={() => { setLibMenu(false); setEditing({ kind: "library" }); }}>New library…</button>
            <button onClick={() => { setLibMenu(false); run(async () => { await api.rebuildIndex(); }); }}>Rebuild search index</button>
            <button onClick={async () => {
              setLibMenu(false);
              const f = await openDialog({ title: "Import a Hoard pack", filters: [{ name: "Hoard pack", extensions: ["hoardpack"] }] });
              if (typeof f === "string") run(() => api.importPack(f));
            }}>Import pack…</button>
            <button onClick={() => { setLibMenu(false); setWatching(true); }}>Watched folders…</button>
            <button onClick={() => { setLibMenu(false); setConnect(true); }}>Browser extension…</button>
            <div className="menu-label">Appearance</div>
            <div className="theme-switch">
              {(["dark", "light", "system"] as ThemePref[]).map((t) => (
                <button key={t} className={theme === t ? "on" : ""} onClick={() => { setTheme(t); setThemeState(t); }}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="nav-scroll">
        <div className="section">
          {row("All items", "all", stats?.all, "◫")}
          {row("Uncategorized", "uncategorized", stats?.uncategorized, "◌")}
          {row("Untagged", "untagged", stats?.untagged, "#")}
          {row("Duplicates", "duplicates", undefined, "⧉")}
          <div className={`nav-row${active("trash") ? " active" : ""}`} onClick={() => go("trash")} role="button">
            <span className="icon">⌫</span><span className="label">Trash</span>
            {active("trash") && !!stats?.trash && <span className="link small" onClick={(e) => { e.stopPropagation(); p.onEmptyTrash(); }}>Empty</span>}
            <span className="count">{stats?.trash}</span>
          </div>
        </div>

        <div className="section-title">
          <span>Smart folders</span>
          <button className="icon-btn" title="New smart folder" onClick={() => setSmartEdit("new")}>＋</button>
        </div>
        <div className="section">
          {lib.meta.smartFolders.map((sf) => (
            <div key={sf.id} className={`nav-row${active("smart", sf.id) ? " active" : ""}`} onClick={() => go("smart", sf.id)}
              onDoubleClick={() => setSmartEdit(sf)}>
              <span className="icon">✦</span><span className="label">{sf.name}</span>
              <span className="count">{stats?.smart[sf.id] ?? ""}</span>
              <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === sf.id ? null : sf.id); }}>⋯</span>
              {menu === sf.id && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setMenu(null); setSmartEdit(sf); }}>Edit rules…</button>
                  <button className="danger" onClick={async () => {
                    setMenu(null);
                    const ok = await ask(`Delete the smart folder "${sf.name}"? No items are deleted.`, { title: "Delete smart folder", kind: "warning", okLabel: "Delete" });
                    if (ok) { if (active("smart", sf.id)) go("all"); run(() => api.deleteSmartFolder(sf.id)); }
                  }}>Delete</button>
                </div>
              )}
            </div>
          ))}
          {!lib.meta.smartFolders.length && <p className="muted small pad">Smart folders collect items by rules, like “5 stars and tagged logo”.</p>}
        </div>

        <div className="section-title" data-drop="__top">
          <span>Folders</span>
          <button className="icon-btn" title="New folder" onClick={() => setEditing({ kind: "new", parent: null })}>＋</button>
        </div>
        <div className="section">
          {lib.meta.folders.map((f) => renderFolder(f, 0))}
          {editing?.kind === "new" && editing.parent === null && (
            <div className="nav-row" style={{ paddingLeft: 24 }}>
              <InlineEdit initial="" placeholder="Folder name" onDone={(v) => { setEditing(null); if (v) run(() => api.createFolder(v, null)); }} />
            </div>
          )}
          {!lib.meta.folders.length && editing?.kind !== "new" && <p className="muted small pad">No folders yet. Drag items onto a folder to file them.</p>}
        </div>

        <div className="section-title"><span>Tags</span></div>
        <div className="section tag-list">
          {stats?.tags.map(([t, n]) => (
            <div key={t} className={`nav-row tag-row${query.tags.includes(t) ? " active" : ""}`}
              onClick={() => setQuery((q) => ({ ...q, tags: q.tags.includes(t) ? q.tags.filter((x) => x !== t) : [...q.tags, t] }))}
              onDoubleClick={() => setEditing({ kind: "tag", tag: t })}>
              <span className="icon">#</span>
              {editing?.kind === "tag" && editing.tag === t ? (
                <InlineEdit initial={t} onDone={(v) => {
                  setEditing(null);
                  if (v && v !== t) run(() => api.renameTag(t, v)).then(() => setQuery((q) => ({ ...q, tags: q.tags.map((x) => (x === t ? v : x)) })));
                }} />
              ) : <span className="label">{t}</span>}
              <span className="count">{n}</span>
              <span className="more" title="Delete tag" onClick={async (e) => {
                e.stopPropagation();
                const ok = await ask(`Remove the tag "${t}" from ${n} item${n > 1 ? "s" : ""}?`, { title: "Delete tag", kind: "warning", okLabel: "Remove" });
                if (ok) run(() => api.renameTag(t, "")).then(() => setQuery((q) => ({ ...q, tags: q.tags.filter((x) => x !== t) })));
              }}>×</span>
            </div>
          ))}
          {!stats?.tags.length && <p className="muted small pad">Tags you add to items show up here.</p>}
        </div>
      </div>
      {!!stats?.aiPending && <div className="ai-status"><span className="spin" /> Analysing {stats.aiPending} item{stats.aiPending > 1 ? "s" : ""} on this Mac…</div>}
      {watching && <WatchedFolders lib={lib} onChange={p.onLibChange} onClose={() => setWatching(false)} fail={fail} />}
      {connect && <BrowserConnect onClose={() => setConnect(false)} fail={fail} />}
      {smartEdit && (
        <SmartFolderEditor
          initial={smartEdit === "new" ? null : smartEdit} folders={lib.meta.folders}
          onClose={() => setSmartEdit(null)}
          onSave={(name: string, mode: string, rules: Rule[]) => {
            const editing = smartEdit;
            setSmartEdit(null);
            if (editing === "new") run(async () => { const sf = await api.createSmartFolder(name, mode, rules); go("smart", sf.id); });
            else if (editing) run(() => api.updateSmartFolder(editing.id, name, mode, rules));
          }}
        />
      )}
    </aside>
  );
}
