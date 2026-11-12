import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "../types";

type Props = {
  src: string; annotations: Annotation[]; editing: boolean;
  onSave: (list: Annotation[]) => void;
  /** When set, dragging picks an area to crop instead of adding a comment. */
  onCrop?: (d: Draft) => void;
};

type Draft = { x: number; y: number; w: number; h: number };

/** An image with comment boxes over it. In editing mode, drag to add a box. */
export default function Annotator({ src, annotations, editing, onSave, onCrop }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; d: Draft } | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { setPending(null); setOpen(null); }, [src]);

  const frac = (e: React.MouseEvent | MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const down = (e: React.MouseEvent) => {
    if (!editing || e.button !== 0 || pending) return;
    e.preventDefault();
    const p = frac(e);
    setDrag({ sx: p.x, sy: p.y, d: { x: p.x, y: p.y, w: 0, h: 0 } });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const p = frac(e);
      setDrag((d) => d && { ...d, d: { x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) } });
    };
    const up = () => {
      setDrag((d) => {
        if (d && d.d.w > 0.01 && d.d.h > 0.01) { setPending(d.d); setText(""); }
        return null;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [drag]);

  const pct = (d: Draft) => ({ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: `${d.w * 100}%`, height: `${d.h * 100}%` });
  const commit = () => {
    if (pending && text.trim()) onSave([...annotations, { id: "", ...pending, text: text.trim(), createdAt: 0 }]);
    setPending(null);
  };

  return (
    <div ref={box} className={`annotator${editing ? " editing" : ""}`} onMouseDown={down}>
      <img src={src} draggable={false} />
      {!onCrop && annotations.map((a, i) => (
        <div key={a.id || i} className={`anno${open === a.id ? " open" : ""}`} style={pct(a)}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setOpen(open === a.id ? null : a.id); }}>
          <span className="anno-num">{i + 1}</span>
          {open === a.id && (
            <div className="anno-pop" onClick={(e) => e.stopPropagation()}>
              <p>{a.text}</p>
              <button className="link danger" onClick={() => { setOpen(null); onSave(annotations.filter((x) => x.id !== a.id)); }}>{tr("Delete")}</button>
            </div>
          )}
        </div>
      ))}
      {drag && <div className="anno drawing" style={pct(drag.d)} />}
      {pending && onCrop && (
        <div className="crop-box" style={pct(pending)} onMouseDown={(e) => e.stopPropagation()}>
          <div className="anno-pop crop-actions" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPending(null)}>{tr("Cancel")}</button>
            <button className="primary" onClick={() => { const d = pending; setPending(null); onCrop(d); }}>{tr("Crop to this area")}</button>
          </div>
        </div>
      )}
      {pending && !onCrop && (
        <div className="anno drawing" style={pct(pending)} onMouseDown={(e) => e.stopPropagation()}>
          <div className="anno-pop" onClick={(e) => e.stopPropagation()}>
            <textarea autoFocus rows={3} placeholder={tr("Comment on this area")} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === "Escape") setPending(null); }} />
            <div className="row-end"><button onClick={() => setPending(null)}>{tr("Cancel")}</button><button className="primary" onClick={commit}>{tr("Add")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
