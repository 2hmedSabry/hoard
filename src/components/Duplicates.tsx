import { t as tr, count } from "../i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, formatSize, thumbUrl } from "../api";
import type { DupGroup, Item } from "../types";

type Props = { root: string; onChanged: () => void; fail: (e: unknown) => void };

const LEVELS: [number, string][] = [[0, "Identical files only"], [4, "Near-identical pictures"], [8, "Similar pictures"], [12, "Loosely similar"]];

function readLevel() {
  try {
    const raw = localStorage.getItem("dupLevel");
    const v = raw === null ? NaN : Number(raw);
    return LEVELS.some(([l]) => l === v) ? v : 4;
  } catch { return 4; }
}

export default function Duplicates({ root, onChanged, fail }: Props) {
  const [level, setLevel] = useState(readLevel);
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [scanning, setScanning] = useState(false);
  // Ids marked to go to the Trash. Default: everything except the first (best) copy.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [merge, setMerge] = useState(true);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const g = await api.findDuplicates(level);
      setGroups(g);
      setMarked(new Set(g.flatMap((x) => x.items.slice(1).map((i) => i.id))));
    } catch (e) { fail(e); } finally { setScanning(false); }
  }, [level, fail]);

  useEffect(() => { try { localStorage.setItem("dupLevel", String(level)); } catch { /* ignore */ } scan(); }, [level]); // eslint-disable-line

  const total = useMemo(() => (groups ?? []).reduce((n, g) => n + g.items.length - 1, 0), [groups]);

  const toggle = (g: DupGroup, id: string) => setMarked((m) => {
    const n = new Set(m);
    n.has(id) ? n.delete(id) : n.add(id);
    // Always keep at least one copy of each group.
    if (g.items.every((i) => n.has(i.id))) n.delete(id);
    return n;
  });

  /** Trash the marked copies of the given groups, first copying their tags, folders and notes to a kept copy. */
  const resolve = async (list: DupGroup[]) => {
    const doomed = list.flatMap((g) => g.items.filter((i) => marked.has(i.id)));
    if (!doomed.length) return;
    const ok = await ask(tr("Move {n} duplicates to the Trash? You can restore them from the Trash.", { n: doomed.length }),
      { title: tr("Remove duplicates"), okLabel: tr("Move to Trash"), cancelLabel: tr("Cancel") });
    if (!ok) return;
    try {
      if (merge) {
        for (const g of list) {
          const keep = g.items.find((i) => !marked.has(i.id));
          const gone = g.items.filter((i) => marked.has(i.id));
          if (!keep || !gone.length) continue;
          const addTags = [...new Set(gone.flatMap((i) => i.tags))].filter((t) => !keep.tags.includes(t));
          const addFolders = [...new Set(gone.flatMap((i) => i.folders))].filter((f) => !keep.folders.includes(f));
          const rating = Math.max(keep.rating, ...gone.map((i) => i.rating));
          const note = keep.note || gone.find((i) => i.note)?.note || "";
          const url = keep.url || gone.find((i) => i.url)?.url || "";
          await api.update([keep.id], { addTags, addFolders, rating, note, url });
        }
      }
      await api.setTrashed(doomed.map((i) => i.id), true);
      onChanged();
      await scan();
    } catch (e) { fail(e); }
  };

  const tile = (g: DupGroup, it: Item, idx: number) => {
    const t = thumbUrl(root, it);
    const out = marked.has(it.id);
    return (
      <div key={it.id} className={`dup-tile${out ? " out" : " keep"}`} onClick={() => toggle(g, it.id)} title={tr("Click to switch between Keep and Trash")}>
        <div className="thumb">{t ? <img src={t} draggable={false} /> : <div className="ext-tile">{it.ext.toUpperCase()}</div>}
          <span className={`dup-flag${out ? " out" : ""}`}>{out ? tr("Trash") : tr("Keep")}</span>
        </div>
        <div className="tile-name" title={it.name}>{it.name}</div>
        <div className="tile-meta">{it.width ? `${it.width}×${it.height} · ` : ""}{formatSize(it.size)}{idx === 0 ? " · " + tr("best") : ""}</div>
        <div className="tile-meta">{new Date(it.createdAt).toLocaleDateString()}{it.tags.length ? " · " + count(it.tags.length, "1 tag", "{n} tags") : ""}</div>
      </div>
    );
  };

  return (
    <div className="dups">
      <header className="toolbar">
        <div className="row">
          <div className="title">
            <h2>{tr("Duplicates")}</h2>
            <span className="muted">{scanning ? tr("Scanning…") : groups ? count(groups.length, "1 group", "{n} groups") + " · " + count(total, "1 extra copy", "{n} extra copies") : ""}</span>
          </div>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))} disabled={scanning}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
          </select>
          <button onClick={scan} disabled={scanning}>{tr("Scan again")}</button>
          <button className="primary" disabled={scanning || !marked.size} onClick={() => groups && resolve(groups)}>
            {tr("Trash {n} marked", { n: marked.size })}
          </button>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            {tr("Keep tags, folders, rating, note and link from removed copies")}</label>
        </div>
      </header>
      <div className="dup-list">
        {groups && !groups.length && !scanning && (
          <div className="empty-state"><p className="big">{tr("No duplicates found")}</p>
            <p className="muted">{level === 0 ? tr("Try a looser setting to find resized or re-saved copies.") : tr("Your library is tidy.")}</p></div>
        )}
        {groups?.map((g) => (
          <section key={g.items.map((i) => i.id).join()} className="dup-group">
            <div className="dup-head">
              <span className={`pill ${g.reason}`}>{g.reason === "exact" ? tr("Identical files") : tr("Similar pictures")}</span>
              <span className="muted">{count(g.items.length, "1 copy", "{n} copies")}</span>
              <span className="grow" />
              <button disabled={!g.items.some((i) => marked.has(i.id))} onClick={() => resolve([g])}>{tr("Resolve this group")}</button>
            </div>
            <div className="dup-row">{g.items.map((it, i) => tile(g, it, i))}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
