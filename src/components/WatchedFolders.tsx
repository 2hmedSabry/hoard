import { t as tr } from "../i18n";
import { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, flattenFolders } from "../api";
import type { LibraryInfo } from "../types";

type Props = { lib: LibraryInfo; onChange: () => void; onClose: () => void; fail: (e: unknown) => void };

export default function WatchedFolders({ lib, onChange, onClose, fail }: Props) {
  const flat = flattenFolders(lib.meta.folders);
  const list = lib.meta.watched ?? [];

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const run = async (f: () => Promise<unknown>) => { try { await f(); onChange(); } catch (e) { fail(e); } };
  const add = async () => {
    const p = await openDialog({ directory: true, title: tr("Choose a folder to watch") });
    if (typeof p === "string") run(() => api.addWatchedFolder(p, null));
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{tr("Watched folders")}</h3>
        <p className="muted">New files that appear in these folders (and their subfolders) are imported automatically while Hoard is open. Your originals stay where they are.</p>
        <div className="watch-list">
          {list.map((w) => (
            <div key={w.id} className={`watch-row${w.enabled ? "" : " off"}`}>
              <label className="check" title={w.enabled ? "Watching" : "Paused"}>
                <input type="checkbox" checked={w.enabled} onChange={(e) => run(() => api.updateWatchedFolder(w.id, e.target.checked, w.folderId))} />
              </label>
              <div className="watch-path" title={w.path}>
                <b>{w.path.split("/").pop()}</b>
                <span className="muted small">{w.path}</span>
              </div>
              <select value={w.folderId ?? ""} onChange={(e) => run(() => api.updateWatchedFolder(w.id, w.enabled, e.target.value || null))}>
                <option value="">{tr("No folder")}</option>
                {flat.map(({ f, depth }) => <option key={f.id} value={f.id}>{"  ".repeat(depth)}{f.name}</option>)}
              </select>
              <button className="icon-btn" title={tr("Stop watching")} onClick={() => run(() => api.removeWatchedFolder(w.id))}>×</button>
            </div>
          ))}
          {!list.length && <p className="muted small">{tr("No watched folders yet. Your Downloads or Screenshots folder is a good start.")}</p>}
        </div>
        <div className="modal-actions">
          <button onClick={add}>{"＋ " + tr("Add folder…")}</button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>{tr("Done")}</button>
        </div>
      </div>
    </div>
  );
}
