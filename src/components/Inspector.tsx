import { useEffect, useMemo, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, flattenFolders, formatDuration, formatSize, thumbUrl } from "../api";
import type { Folder, Item, ItemPatch, Stats } from "../types";
import Stars from "./Stars";
import BatchRename from "./BatchRename";

type Props = {
  root: string; items: Item[]; stats: Stats | null; folders: Folder[]; inTrash: boolean; total: number;
  onUpdate: (ids: string[], patch: ItemPatch) => void; onTrash: (ids: string[], trashed: boolean) => void;
  onChanged: () => void;
  onNotice: (msg: string) => void;
  onColor: (hex: string) => void;
  onSimilar: (id: string) => void; onTag: (t: string) => void; onPreview: (id: string) => void; fail: (e: unknown) => void;
};

function TagAdder({ onAdd, known }: { onAdd: (tags: string[]) => void; known: string[] }) {
  const [v, setV] = useState("");
  const commit = () => {
    const tags = v.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length) onAdd(tags);
    setV("");
  };
  return (
    <>
      <input className="tag-input" list="known-tags" placeholder="Add tag, press Enter" value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} onBlur={commit} />
      <datalist id="known-tags">{known.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );
}

function FolderAdder({ folders, exclude, onAdd }: { folders: Folder[]; exclude: string[]; onAdd: (id: string) => void }) {
  const flat = flattenFolders(folders).filter((x) => !exclude.includes(x.f.id));
  if (!flat.length) return null;
  return (
    <select value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
      <option value="">Add to folder…</option>
      {flat.map(({ f, depth }) => <option key={f.id} value={f.id}>{"  ".repeat(depth)}{f.name}</option>)}
    </select>
  );
}

export default function Inspector(p: Props) {
  const { root, items, stats, folders, inTrash } = p;
  const known = useMemo(() => stats?.tags.map(([t]) => t) ?? [], [stats]);
  const folderNames = useMemo(() => new Map(flattenFolders(folders).map(({ f }) => [f.id, f.name])), [folders]);
  const one = items.length === 1 ? items[0] : null;

  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => { setName(one?.name ?? ""); setNote(one?.note ?? ""); setUrl(one?.url ?? ""); }, [one?.id, one?.modifiedAt]); // eslint-disable-line

  const images = items.filter((i) => i.kind === "image" && !["svg", "psd", "heic", "heif", "avif", "raw", "exr", "hdr"].includes(i.ext));
  const transform = async (op: "cw" | "ccw" | "flip_h" | "flip_v") => {
    setBusy(true);
    try { await api.transformItems(images.map((i) => i.id), op); p.onChanged(); } catch (e) { p.fail(e); } finally { setBusy(false); }
  };
  const tools = (
    <div className="tool-row">
      {images.length > 0 && <>
        <button disabled={busy} title="Rotate left" onClick={() => transform("ccw")}>⟲</button>
        <button disabled={busy} title="Rotate right" onClick={() => transform("cw")}>⟳</button>
        <button disabled={busy} title="Flip horizontally" onClick={() => transform("flip_h")}>⇋</button>
        <button disabled={busy} title="Flip vertically" onClick={() => transform("flip_v")}>⇵</button>
      </>}
      <button title="Save these items as a .hoardpack to share or move to another library" onClick={async () => {
        const dest = await saveDialog({ title: "Export pack", defaultPath: `${items.length === 1 ? items[0].name : "Hoard pack"}.hoardpack`, filters: [{ name: "Hoard pack", extensions: ["hoardpack"] }] });
        if (!dest) return;
        setBusy(true);
        try { const n = await api.exportPack(items.map((i) => i.id), dest); p.onNotice(`Exported ${n} item${n > 1 ? "s" : ""} to a pack.`); } catch (e) { p.fail(e); } finally { setBusy(false); }
      }}>Export pack…</button>
      <button title="Copy the original files to a folder" onClick={async () => {
        const dest = await openDialog({ directory: true, title: "Copy files to…" });
        if (typeof dest !== "string") return;
        setBusy(true);
        try { const n = await api.exportFiles(items.map((i) => i.id), dest); p.onNotice(`Copied ${n} file${n > 1 ? "s" : ""}.`); } catch (e) { p.fail(e); } finally { setBusy(false); }
      }}>Copy files to…</button>
      <button onClick={() => setRenaming(true)}>Rename{items.length > 1 ? "…" : " with pattern…"}</button>
      {renaming && (
        <BatchRename items={items} onClose={() => setRenaming(false)}
          onApply={async (names) => { setRenaming(false); try { await api.renameItems(names); p.onChanged(); } catch (e) { p.fail(e); } }} />
      )}
    </div>
  );

  if (!items.length) {
    return (
      <aside className="inspector">
        <div className="inspector-empty">
          <p className="big">{p.total} item{p.total === 1 ? "" : "s"}</p>
          <p className="muted">Select an item to see and edit its details.</p>
          <ul className="muted small tips">
            <li>Space — preview</li><li>⌘A — select all</li><li>Delete — move to Trash</li>
            <li>⌘F — search</li><li>Drag items onto a folder to file them</li>
          </ul>
        </div>
      </aside>
    );
  }

  const ids = items.map((i) => i.id);

  if (!one) {
    const common = items.reduce<string[]>((acc, it) => acc.filter((t) => it.tags.includes(t)), items[0].tags);
    return (
      <aside className="inspector">
        <div className="stack">
          {items.slice(0, 3).map((it, i) => {
            const t = thumbUrl(root, it);
            return t ? <img key={it.id} src={t} style={{ transform: `rotate(${(i - 1) * 6}deg)` }} /> : null;
          })}
        </div>
        <h3>{items.length} items selected</h3>
        {tools}
        <section>
          <label>Rating</label>
          <Stars value={items.every((i) => i.rating === items[0].rating) ? items[0].rating : 0} onChange={(r) => p.onUpdate(ids, { rating: r })} />
        </section>
        <section>
          <label>Tags in common</label>
          <div className="tags">
            {common.map((t) => <span key={t} className="tag">{t}<button onClick={() => p.onUpdate(ids, { removeTags: [t] })}>×</button></span>)}
          </div>
          <TagAdder known={known} onAdd={(tags) => p.onUpdate(ids, { addTags: tags })} />
        </section>
        <section>
          <label>Folders</label>
          <FolderAdder folders={folders} exclude={[]} onAdd={(f) => p.onUpdate(ids, { addFolders: [f] })} />
        </section>
        <div className="actions">
          {inTrash
            ? <button onClick={() => p.onTrash(ids, false)}>Restore {items.length} items</button>
            : <button className="danger" onClick={() => p.onTrash(ids, true)}>Move {items.length} items to Trash</button>}
        </div>
      </aside>
    );
  }

  const t = thumbUrl(root, one);
  const save = (patch: ItemPatch) => p.onUpdate([one.id], patch);

  return (
    <aside className="inspector">
      <div className="hero" onClick={() => p.onPreview(one.id)} title="Preview (Space)">
        {t ? <img src={t} /> : <div className="ext-tile">{one.ext.toUpperCase()}</div>}
      </div>
      {one.palette.length > 0 && (
        <div className="palette">
          {one.palette.map((s) => (
            <button key={s.hex} title={`${s.hex} · ${Math.round(s.ratio * 100)}% — find similar`} style={{ background: s.hex, flexGrow: Math.max(s.ratio, 0.08) }}
              onClick={() => p.onColor(s.hex)} />
          ))}
        </div>
      )}
      <input className="name-input" value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== one.name && save({ name })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <Stars value={one.rating} onChange={(r) => save({ rating: r })} size={18} />

      <section>
        <label>Tags</label>
        <div className="tags">
          {one.tags.map((tg) => (
            <span key={tg} className="tag"><span onClick={() => p.onTag(tg)} title="Filter by this tag">{tg}</span>
              <button onClick={() => save({ removeTags: [tg] })}>×</button></span>
          ))}
        </div>
        <TagAdder known={known.filter((k) => !one.tags.includes(k))} onAdd={(tags) => save({ addTags: tags })} />
        {(() => {
          const sugg = (one.labels ?? []).filter((l) => !one.tags.some((t) => t.toLowerCase() === l.toLowerCase()));
          return sugg.length ? (
            <div className="suggest">
              <span className="muted small">Suggested:</span>
              {sugg.map((l) => <button key={l} className="chip" title="Add as tag" onClick={() => save({ addTags: [l] })}>+ {l}</button>)}
              {sugg.length > 1 && <button className="link small" onClick={() => save({ addTags: sugg })}>Add all</button>}
            </div>
          ) : null;
        })()}
      </section>
      {one.ocr && (
        <section>
          <label>Text in image</label>
          <pre className="ocr" dir="auto">{one.ocr}</pre>
        </section>
      )}

      <section>
        <label>Folders</label>
        <div className="tags">
          {one.folders.map((f) => (
            <span key={f} className="tag folder">{folderNames.get(f) ?? "?"}<button onClick={() => save({ removeFolders: [f] })}>×</button></span>
          ))}
        </div>
        <FolderAdder folders={folders} exclude={one.folders} onAdd={(f) => save({ addFolders: [f] })} />
      </section>

      {!!one.annotations?.length && (
        <section>
          <label>Area comments ({one.annotations.length})</label>
          <ol className="anno-list">
            {one.annotations.map((a) => <li key={a.id} onClick={() => p.onPreview(one.id)}>{a.text}</li>)}
          </ol>
        </section>
      )}
      <section>
        <label>Note</label>
        <textarea rows={3} value={note} placeholder="Add a note" onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== one.note && save({ note })} />
      </section>

      <section>
        <label>Source link</label>
        <div className="url-row">
          <input value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url !== one.url && save({ url })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          {one.url && /^https?:\/\//.test(one.url) && <button className="icon-btn" title="Open link in browser" onClick={() => api.openUrl(one.url).catch(p.fail)}>↗</button>}
        </div>
      </section>

      <section>
        <label>Info</label>
        <dl className="info">
          <dt>Type</dt><dd>{one.ext.toUpperCase()} · {one.kind}</dd>
          {one.width > 0 && <><dt>Size</dt><dd>{one.width} × {one.height}</dd></>}
          {one.duration != null && <><dt>Length</dt><dd>{formatDuration(one.duration)}</dd></>}
          <dt>File size</dt><dd>{formatSize(one.size)}</dd>
          <dt>Added</dt><dd>{new Date(one.createdAt).toLocaleString()}</dd>
          <dt>Edited</dt><dd>{new Date(one.modifiedAt).toLocaleString()}</dd>
        </dl>
      </section>

      {tools}
      <div className="actions">
        {one.analyzed && ["image", "video", "document"].includes(one.kind) && <button onClick={() => p.onSimilar(one.id)}>Find similar</button>}
        <button onClick={() => api.open(one.id).catch(p.fail)}>Open</button>
        <button onClick={() => api.reveal(one.id).catch(p.fail)}>Show in Finder</button>
        {inTrash
          ? <button onClick={() => p.onTrash([one.id], false)}>Restore</button>
          : <button className="danger" onClick={() => p.onTrash([one.id], true)}>Move to Trash</button>}
      </div>
    </aside>
  );
}
