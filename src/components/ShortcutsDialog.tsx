import { useEffect, useState } from "react";
import { t as tr } from "../i18n";
import { comboOf, DEFAULTS, getShortcuts, LABELS, pretty, resetShortcuts, setShortcut, type Action } from "../shortcuts";

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [map, setMap] = useState(getShortcuts());
  const [recording, setRecording] = useState<Action | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (recording) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) { setRecording(null); return; }
        const c = comboOf(e);
        if (!c) return;
        setShortcut(recording, c); setMap(getShortcuts()); setRecording(null);
      } else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [recording, onClose]);

  const used = new Map<string, Action[]>();
  (Object.keys(map) as Action[]).forEach((a) => used.set(map[a], [...(used.get(map[a]) ?? []), a]));

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{tr("Keyboard shortcuts")}</h3>
        <p className="muted small">{tr("Click a shortcut, then press the new keys. Esc cancels.")}</p>
        <div className="shortcut-list">
          {(Object.keys(LABELS) as Action[]).map((a) => {
            const clash = (used.get(map[a])?.length ?? 0) > 1;
            return (
              <div key={a} className="shortcut-row">
                <span>{tr(LABELS[a])}</span>
                {clash && <span className="error small">{tr("Used twice")}</span>}
                <button className={`kbd${recording === a ? " rec" : ""}`} onClick={() => setRecording(a)}>
                  {recording === a ? tr("Press keys…") : pretty(map[a])}
                </button>
                {map[a] !== DEFAULTS[a] && <button className="icon-btn" title={tr("Reset")} onClick={() => { setShortcut(a, DEFAULTS[a]); setMap(getShortcuts()); }}>↺</button>}
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="link" onClick={() => { resetShortcuts(); setMap(getShortcuts()); }}>{tr("Reset all")}</button>
          <span className="grow" />
          <button className="primary" onClick={onClose}>{tr("Done")}</button>
        </div>
      </div>
    </div>
  );
}
