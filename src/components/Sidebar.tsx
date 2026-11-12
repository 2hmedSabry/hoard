import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { beginDrag, type DropDetail } from "../drag";
import type { Folder, LibraryInfo, Query, Rule, Scope, SmartFolder, Stats } from "../types";
import SmartFolderEditor from "./SmartFolderEditor";
import type { PluginInfo } from "./PluginHost";
import BrowserConnect from "./BrowserConnect";
import PasswordPrompt from "./PasswordPrompt";
import ShortcutsDialog from "./ShortcutsDialog";
import WatchedFolders from "./WatchedFolders";
import { getTheme, setTheme, type ThemePref } from "../theme";
import { getLangPref, LANGS, setLang, type LangPref } from "../i18n";
import InlineEdit from "./InlineEdit";

type Props = {
  lib: LibraryInfo; stats: Stats | null; query: Query; setQuery: (f: (q: Query) => Query) => void;
  onLibChange: () => void; onSwitchLibrary: (l: LibraryInfo) => void;
  onDropItems: (ids: string[], folderId: string) => void; onEmptyTrash: () => void; fail: (e: unknown) => void;
  onOpenPlugin: (p: PluginInfo) => void;
};

type Editing = { kind: "new"; parent: string | null } | { kind: "rename"; id: string } | { kind: "tag"; tag: string } | { kind: "group"; id: string } | { kind: "library" } | null;

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
  const [keys, setKeys] = useState(false);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [pwPrompt, setPwPrompt] = useState<{ mode: "set" | "unlock" | "remove"; folder: Folder } | null>(null);
  const loadUnlocked = () => api.unlockedFolders().then((ids) => setUnlocked(new Set(ids))).catch(fail);
  useEffect(() => { loadUnlocked(); }, [lib.root]); // eslint-disable-line
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const loadPlugins = () => api.listPlugins().then(setPlugins).catch(fail);
  useEffect(() => { loadPlugins(); }, []); // eslint-disable-line
  const [watching, setWatching] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getTheme);
  const [langPref, setLangPref] = useState<LangPref>(getLangPref);
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
    const path = await openDialog({ directory: true, title: tr("Open a .hoard library") });
    if (typeof path === "string") api.openLibrary(path).then(p.onSwitchLibrary).catch(fail);
  };
  const newLibrary = async (name: string) => {
    const parent = await openDialog({ directory: true, title: tr("Choose where to save the library") });
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

  const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8b8d98"];
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const grouped = new Set((lib.meta.tagGroups ?? []).flatMap((g) => g.tags));
  const ungrouped = (stats?.tags ?? []).filter(([t]) => !grouped.has(t));

  const tagRow = (t: string, n: number, color?: string) => (
    <div key={t} className={`nav-row tag-row${query.tags.includes(t) ? " active" : ""}`}
      onClick={() => setQuery((q) => ({ ...q, tags: q.tags.includes(t) ? q.tags.filter((x) => x !== t) : [...q.tags, t] }))}
      onDoubleClick={() => setEditing({ kind: "tag", tag: t })}>
      <span className="icon" style={color ? { color } : undefined}>#</span>
      {editing?.kind === "tag" && editing.tag === t ? (
        <InlineEdit initial={t} onDone={(v) => {
          setEditing(null);
          if (v && v !== t) run(() => api.renameTag(t, v)).then(() => setQuery((q) => ({ ...q, tags: q.tags.map((x) => (x === t ? v : x)) })));
        }} />
      ) : <span className="label">{t}</span>}
      <span className="count">{n}</span>
      <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === "tag:" + t ? null : "tag:" + t); }}>⋯</span>
      {menu === "tag:" + t && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {(lib.meta.tagGroups ?? []).length > 0 && <div className="menu-label">{tr("Move to group")}</div>}
          {(lib.meta.tagGroups ?? []).map((g) => (
            <button key={g.id} onClick={() => { setMenu(null); run(() => api.setTagGroup(t, g.id)); }}>
              <span className="dot" style={{ background: g.color ?? "var(--muted)" }} /> {g.name}
            </button>
          ))}
          {grouped.has(t) && <button onClick={() => { setMenu(null); run(() => api.setTagGroup(t, null)); }}>{tr("Remove from group")}</button>}
          <button onClick={() => { setMenu(null); setEditing({ kind: "tag", tag: t }); }}>{tr("Rename")}</button>
          <button className="danger" onClick={async () => {
            setMenu(null);
            const ok = await ask(tr("Remove the tag “{tag}” from {n} items?", { tag: t, n }), { title: tr("Delete tag"), kind: "warning", okLabel: tr("Remove"), cancelLabel: tr("Cancel") });
            if (ok) run(() => api.renameTag(t, "")).then(() => setQuery((q) => ({ ...q, tags: q.tags.filter((x) => x !== t) })));
          }}>{tr("Delete tag")}</button>
        </div>
      )}
    </div>
  );

  const row = (label: string, scope: Scope, count?: number, icon?: string) => (
    <button className={`nav-row${active(scope) ? " active" : ""}`} onClick={() => go(scope)}>
      <span className="icon">{icon}</span><span className="label">{tr(label)}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );

  const renderFolder = (f: Folder, depth: number): React.ReactNode => {
    const isOpen = open.has(f.id);
    return (
      <div key={f.id}>
        <div
          className={`nav-row folder${active("folder", f.id) ? " active" : ""}`}
          style={{ paddingInlineStart: 8 + depth * 14 }} data-drop={f.id}
          onMouseDown={(e) => { if (!(e.target as HTMLElement).closest("input, .more, .twisty, .menu")) beginDrag(e, () => ({ kind: "folder", id: f.id }), () => f.name); }}
          onClick={() => (f.lock && !unlocked.has(f.id) ? setPwPrompt({ mode: "unlock", folder: f }) : go("folder", f.id))}
          onDoubleClick={() => setEditing({ kind: "rename", id: f.id })}
        >
          <span className={`twisty${f.children.length ? "" : " empty"}${isOpen ? " open" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>▸</span>
          <span className="icon folder-icon" style={f.color ? { color: f.color } : undefined}>{f.lock ? (unlocked.has(f.id) ? "🔓" : "🔒") : f.color ? "■" : "▢"}</span>
          {editing?.kind === "rename" && editing.id === f.id ? (
            <InlineEdit initial={f.name} onDone={(v) => { setEditing(null); if (v && v !== f.name) run(() => api.renameFolder(f.id, v)); }} />
          ) : <span className="label">{f.name}</span>}
          <span className="count">{stats?.folders[f.id] ?? ""}</span>
          <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === f.id ? null : f.id); }}>⋯</span>
          {menu === f.id && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenu(null); toggle(f.id, true); setEditing({ kind: "new", parent: f.id }); }}>{tr("New subfolder")}</button>
              <button onClick={() => { setMenu(null); setEditing({ kind: "rename", id: f.id }); }}>{tr("Rename")}</button>
              <div className="swatch-row">
                {COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => { setMenu(null); run(() => api.setFolderColor(f.id, c)); }} />)}
                {f.color && <button className="swatch none" title={tr("No colour")} onClick={() => { setMenu(null); run(() => api.setFolderColor(f.id, null)); }}>×</button>}
              </div>
              {depth > 0 && <button onClick={() => { setMenu(null); run(() => api.moveFolder(f.id, null)); }}>{tr("Move to top level")}</button>}
              {!f.lock && <button onClick={() => { setMenu(null); setPwPrompt({ mode: "set", folder: f }); }}>{tr("Lock with password…")}</button>}
              {f.lock && unlocked.has(f.id) && <button onClick={() => { setMenu(null); if (active("folder", f.id)) go("all"); run(() => api.relockFolder(f.id)).then(loadUnlocked); }}>{tr("Lock now")}</button>}
              {f.lock && <button onClick={() => { setMenu(null); setPwPrompt({ mode: "remove", folder: f }); }}>{tr("Remove password…")}</button>}
              <button className="danger" onClick={async () => {
                setMenu(null);
                const ok = await ask(tr("Delete the folder “{name}” and its subfolders? The items stay in your library.", { name: f.name }), { title: tr("Delete folder"), kind: "warning", okLabel: tr("Delete"), cancelLabel: tr("Cancel") });
                if (ok) { if (active("folder", f.id)) go("all"); run(() => api.deleteFolder(f.id)); }
              }}>{tr("Delete folder")}</button>
            </div>
          )}
        </div>
        {isOpen && f.children.map((c) => renderFolder(c, depth + 1))}
        {isOpen && editing?.kind === "new" && editing.parent === f.id && (
          <div className="nav-row" style={{ paddingInlineStart: 8 + (depth + 1) * 14 + 16 }}>
            <InlineEdit initial="" placeholder={tr("Folder name")} onDone={(v) => { setEditing(null); if (v) run(() => api.createFolder(v, f.id)); }} />
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
          <InlineEdit initial="" placeholder={tr("New library name")} onDone={(v) => { setEditing(null); if (v) newLibrary(v); }} />
        ) : (
          <>
            <div className="lib-name" title={lib.root}>{lib.meta.name}</div>
            <span className="chev">⌄</span>
          </>
        )}
        {libMenu && (
          <div className="menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setLibMenu(false); switchLibrary(); }}>{tr("Open library…")}</button>
            <button onClick={() => { setLibMenu(false); setEditing({ kind: "library" }); }}>{tr("New library…")}</button>
            <button onClick={() => { setLibMenu(false); run(async () => { await api.rebuildIndex(); }); }}>{tr("Rebuild search index")}</button>
            <button onClick={async () => {
              setLibMenu(false);
              const f = await openDialog({ title: tr("Import a Hoard pack"), filters: [{ name: "Hoard pack", extensions: ["hoardpack"] }] });
              if (typeof f === "string") run(() => api.importPack(f));
            }}>{tr("Import pack…")}</button>
            <button onClick={() => { setLibMenu(false); setWatching(true); }}>{tr("Watched folders…")}</button>
            <button onClick={() => { setLibMenu(false); setConnect(true); }}>{tr("Browser extension…")}</button>
            <button onClick={() => { setLibMenu(false); setKeys(true); }}>{tr("Keyboard shortcuts…")}</button>
            <div className="menu-label">{tr("Language")}</div>
            <div className="theme-switch">
              {LANGS.map(([l, label]) => (
                <button key={l} className={langPref === l ? "on" : ""} onClick={() => { setLang(l); setLangPref(l); }}>
                  {l === "system" ? tr("System") : label}
                </button>
              ))}
            </div>
            <div className="menu-label">{tr("Appearance")}</div>
            <div className="theme-switch">
              {(["dark", "light", "system"] as ThemePref[]).map((t) => (
                <button key={t} className={theme === t ? "on" : ""} onClick={() => { setTheme(t); setThemeState(t); }}>
                  {tr(t[0].toUpperCase() + t.slice(1))}
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
            <span className="icon">⌫</span><span className="label">{tr("Trash")}</span>
            {active("trash") && !!stats?.trash && <span className="link small" onClick={(e) => { e.stopPropagation(); p.onEmptyTrash(); }}>{tr("Empty")}</span>}
            <span className="count">{stats?.trash}</span>
          </div>
        </div>

        <div className="section-title">
          <span>{tr("Smart folders")}</span>
          <button className="icon-btn" title={tr("New smart folder")} onClick={() => setSmartEdit("new")}>＋</button>
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
                  <button onClick={() => { setMenu(null); setSmartEdit(sf); }}>{tr("Edit rules…")}</button>
                  <button className="danger" onClick={async () => {
                    setMenu(null);
                    const ok = await ask(tr("Delete the smart folder “{name}”? No items are deleted.", { name: sf.name }), { title: tr("Delete smart folder"), kind: "warning", okLabel: tr("Delete"), cancelLabel: tr("Cancel") });
                    if (ok) { if (active("smart", sf.id)) go("all"); run(() => api.deleteSmartFolder(sf.id)); }
                  }}>{tr("Delete")}</button>
                </div>
              )}
            </div>
          ))}
          {!lib.meta.smartFolders.length && <p className="muted small pad">{tr("Smart folders collect items by rules, like “5 stars and tagged logo”.")}</p>}
        </div>

        <div className="section-title" data-drop="__top">
          <span>{tr("Folders")}</span>
          <button className="icon-btn" title={tr("New folder")} onClick={() => setEditing({ kind: "new", parent: null })}>＋</button>
        </div>
        <div className="section">
          {lib.meta.folders.map((f) => renderFolder(f, 0))}
          {editing?.kind === "new" && editing.parent === null && (
            <div className="nav-row" style={{ paddingInlineStart: 24 }}>
              <InlineEdit initial="" placeholder={tr("Folder name")} onDone={(v) => { setEditing(null); if (v) run(() => api.createFolder(v, null)); }} />
            </div>
          )}
          {!lib.meta.folders.length && editing?.kind !== "new" && <p className="muted small pad">{tr("No folders yet. Drag items onto a folder to file them.")}</p>}
        </div>

        <div className="section-title">
          <span>{tr("Tags")}</span>
          <button className="icon-btn" title={tr("New tag group")} onClick={() => setEditing({ kind: "group", id: "" })}>＋</button>
        </div>
        <div className="section tag-list">
          {editing?.kind === "group" && editing.id === "" && (
            <div className="nav-row"><InlineEdit initial="" placeholder={tr("Group name")} onDone={(v) => { setEditing(null); if (v) run(() => api.saveTagGroup("", v, null)); }} /></div>
          )}
          {(lib.meta.tagGroups ?? []).map((g) => {
            const inGroup = (stats?.tags ?? []).filter(([t]) => g.tags.includes(t));
            const open = !collapsed.has(g.id);
            return (
              <div key={g.id} className="tag-group">
                <div className="nav-row group-row" onClick={() => toggleGroup(g.id)}>
                  <span className={`twisty${open ? " open" : ""}`}>▸</span>
                  <span className="dot" style={{ background: g.color ?? "var(--muted)" }} />
                  {editing?.kind === "group" && editing.id === g.id
                    ? <InlineEdit initial={g.name} onDone={(v) => { setEditing(null); if (v && v !== g.name) run(() => api.saveTagGroup(g.id, v, g.color ?? null)); }} />
                    : <span className="label">{g.name}</span>}
                  <span className="count">{inGroup.length}</span>
                  <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === "group:" + g.id ? null : "group:" + g.id); }}>⋯</span>
                  {menu === "group:" + g.id && (
                    <div className="menu" onClick={(e) => e.stopPropagation()}>
                      <div className="swatch-row">{COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => { setMenu(null); run(() => api.saveTagGroup(g.id, g.name, c)); }} />)}</div>
                      <button onClick={() => { setMenu(null); setEditing({ kind: "group", id: g.id }); }}>{tr("Rename")}</button>
                      <button className="danger" onClick={() => { setMenu(null); run(() => api.deleteTagGroup(g.id)); }}>{tr("Delete group (keeps tags)")}</button>
                    </div>
                  )}
                </div>
                {open && inGroup.map(([t, n]) => tagRow(t, n, g.color ?? undefined))}
              </div>
            );
          })}
          {(lib.meta.tagGroups ?? []).length > 0 && ungrouped.length > 0 && <div className="sub-title">{tr("Other tags")}</div>}
          {ungrouped.map(([t, n]) => tagRow(t, n))}
          {!stats?.tags.length && <p className="muted small pad">{tr("Tags you add to items show up here.")}</p>}
        </div>

        <div className="section-title">
          <span>{tr("Plugins")}</span>
          <button className="icon-btn" title={tr("Install plugin…")} onClick={async () => {
            const d = await openDialog({ directory: true, title: tr("Choose a plugin folder (with plugin.json)") });
            if (typeof d === "string") api.installPlugin(d).then(loadPlugins).catch(fail);
          }}>＋</button>
        </div>
        <div className="section">
          {plugins.map((pl) => (
            <div key={pl.id} className="nav-row" title={pl.description} onClick={() => p.onOpenPlugin(pl)}>
              <span className="icon">⧈</span><span className="label">{pl.name}</span>
              <span className="more" onClick={(e) => { e.stopPropagation(); setMenu(menu === "plugin:" + pl.id ? null : "plugin:" + pl.id); }}>⋯</span>
              {menu === "plugin:" + pl.id && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <p className="muted small pad">{pl.description || pl.name}<br />{tr("Permissions")}: {pl.permissions.join(", ") || "—"}</p>
                  <button className="danger" onClick={async () => {
                    setMenu(null);
                    const ok = await ask(tr("Remove the plugin “{name}”?", { name: pl.name }), { title: tr("Remove plugin"), kind: "warning", okLabel: tr("Remove"), cancelLabel: tr("Cancel") });
                    if (ok) api.removePlugin(pl.id).then(loadPlugins).catch(fail);
                  }}>{tr("Remove plugin")}</button>
                </div>
              )}
            </div>
          ))}
          {!plugins.length && <p className="muted small pad">{tr("Plugins add tools to Hoard. Install one from a folder with ＋.")}</p>}
          <button className="link small pad-btn" onClick={() => api.revealPluginsFolder().catch(fail)}>{tr("Open plugins folder")}</button>
        </div>
      </div>
      {!!stats?.aiPending && <div className="ai-status"><span className="spin" /> {tr("Analysing {n} items on this Mac…", { n: stats.aiPending })}</div>}
      {watching && <WatchedFolders lib={lib} onChange={p.onLibChange} onClose={() => setWatching(false)} fail={fail} />}
      {pwPrompt && (
        <PasswordPrompt mode={pwPrompt.mode} folderName={pwPrompt.folder.name} onClose={() => setPwPrompt(null)}
          onSubmit={async (pw) => {
            const f = pwPrompt.folder;
            if (pwPrompt.mode === "set") { await api.lockFolder(f.id, pw); if (active("folder", f.id)) go("all"); }
            else if (pwPrompt.mode === "unlock") { if (!(await api.unlockFolder(f.id, pw))) return false; go("folder", f.id); }
            else if (!(await api.removeFolderLock(f.id, pw))) return false;
            await loadUnlocked();
            p.onLibChange();
          }} />
      )}
      {keys && <ShortcutsDialog onClose={() => setKeys(false)} />}
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
