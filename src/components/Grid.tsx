import { t as tr } from "../i18n";
import { memo, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDuration, thumbUrl } from "../api";
import { beginDrag } from "../drag";
import type { Item, Query } from "../types";

type Props = {
  root: string; items: Item[]; selected: Set<string>; thumbSize: number;
  onSelect: (id: string, e: React.MouseEvent) => void; onClear: () => void; onOpen: (id: string) => void; emptyHint: Query;
  onCols: (n: number) => void; focusId: string | null;
  onSelectMany: (ids: string[], add: boolean) => void;
  onContext: (id: string, x: number, y: number) => void;
};

const GAP = 14;
const LABEL = 40;

const Tile = memo(function Tile({ root, item, size, selected, selectedIds, onSelect, onOpen, onContext }: {
  root: string; item: Item; size: number; selected: boolean; selectedIds: Set<string>;
  onSelect: Props["onSelect"]; onOpen: Props["onOpen"]; onContext: Props["onContext"];
}) {
  const src = thumbUrl(root, item);
  const [failed, setFailed] = useState(false);
  return (
    <div
      id={"tile-" + item.id} role="option" aria-selected={selected} tabIndex={-1}
      aria-label={`${item.name}, ${item.ext.toUpperCase()}${item.width ? `, ${item.width} × ${item.height}` : ""}${item.rating ? `, ${item.rating}★` : ""}`}
      className={`tile${selected ? " selected" : ""}`} style={{ width: size }}
      onClick={(e) => { e.stopPropagation(); onSelect(item.id, e); }}
      onDoubleClick={() => onOpen(item.id)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContext(item.id, e.clientX, e.clientY); }}
      onMouseDown={(e) => {
        const ids = () => (selectedIds.has(item.id) ? [...selectedIds] : [item.id]);
        beginDrag(e, () => ({ kind: "items", ids: ids() }), () => (ids().length > 1 ? `${ids().length} items` : item.name));
      }}
    >
      <div className="thumb" style={{ height: size }}>
        {src && !failed
          ? <img src={src} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
          : <div className="ext-tile">{item.ext.toUpperCase() || "FILE"}</div>}
        {item.duration != null && <span className="badge">{formatDuration(item.duration)}</span>}
        {item.kind !== "image" && item.duration == null && <span className="badge">{item.ext.toUpperCase()}</span>}
      </div>
      <div className="tile-name" title={item.name}>{item.name}</div>
      <div className="tile-meta">
        {item.width ? `${item.width}×${item.height}` : item.bpm ? `${item.ext.toUpperCase()} · ${Math.round(item.bpm)} BPM` : item.ext.toUpperCase()}
        {item.rating ? <span className="tile-stars">{"★".repeat(item.rating)}</span> : null}
      </div>
    </div>
  );
});

export default function Grid({ root, items, selected, thumbSize, onSelect, onClear, onOpen, emptyHint, onCols, focusId, onSelectMany, onContext }: Props) {
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const banded = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = width - GAP * 2;
  const cols = Math.max(1, Math.floor((inner + GAP) / (thumbSize + GAP)));
  const size = Math.floor((inner - GAP * (cols - 1)) / cols);
  const rows = Math.ceil(items.length / cols);
  useEffect(() => { onCols(cols); }, [cols, onCols]);

  // Keep the keyboard-focused tile in view and give it focus for screen readers.
  useEffect(() => {
    if (!focusId) return;
    const idx = items.findIndex((i) => i.id === focusId);
    if (idx < 0) return;
    v.scrollToIndex(Math.floor(idx / cols), { align: "auto" });
    requestAnimationFrame(() => document.getElementById("tile-" + focusId)?.focus({ preventScroll: true }));
  }, [focusId]); // eslint-disable-line

  const v = useVirtualizer({
    count: rows, getScrollElement: () => scroller.current, estimateSize: () => size + LABEL + GAP, overscan: 4,
  });
  useEffect(() => { v.measure(); }, [size, v]);

  // Keep the selected item in view when moving with arrow keys.
  useEffect(() => {
    if (selected.size !== 1) return;
    const idx = items.findIndex((i) => selected.has(i.id));
    if (idx >= 0) v.scrollToIndex(Math.floor(idx / cols), { align: "auto" });
  }, [selected, items, cols, v]);

  if (!items.length) {
    const filtered = emptyHint.text || emptyHint.tags.length || emptyHint.kinds.length || emptyHint.color || emptyHint.minRating;
    return (
      <div className="grid empty" ref={scroller} onClick={onClear}>
        <div className="empty-state">
          {emptyHint.scope === "trash" ? <p>{tr("The Trash is empty.")}</p>
            : filtered ? <p>{tr("Nothing matches these filters.")}</p>
              : <><p className="big">{tr("Drop files or folders here")}</p><p className="muted">or use Import in the top right.</p></>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid" ref={scroller} onClick={() => { if (banded.current) { banded.current = false; return; } onClear(); }}
      onMouseDown={(e) => {
        // Drag on empty space to select with a rectangle (Cmd/Shift adds to the selection).
        if (e.button !== 0 || (e.target as HTMLElement).closest(".tile")) return;
        const box = scroller.current!.getBoundingClientRect();
        const sx = e.clientX - box.left, sy = e.clientY - box.top + scroller.current!.scrollTop;
        const add = e.metaKey || e.ctrlKey || e.shiftKey;
        const start = new Set(add ? selected : []);
        const move = (ev: MouseEvent) => {
          const x = ev.clientX - box.left, y = ev.clientY - box.top + scroller.current!.scrollTop;
          if (Math.hypot(x - sx, y - sy) < 4) return;
          banded.current = true;
          const r = { x0: Math.min(sx, x), y0: Math.min(sy, y), x1: Math.max(sx, x), y1: Math.max(sy, y) };
          setBand(r);
          const hit: string[] = [];
          scroller.current!.querySelectorAll<HTMLElement>(".tile").forEach((t) => {
            const tr2 = t.getBoundingClientRect();
            const tx0 = tr2.left - box.left, ty0 = tr2.top - box.top + scroller.current!.scrollTop;
            if (tx0 < r.x1 && tx0 + tr2.width > r.x0 && ty0 < r.y1 && ty0 + tr2.height > r.y0) hit.push(t.id.slice(5));
          });
          onSelectMany([...start, ...hit], false);
        };
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); setBand(null); };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      role="listbox" aria-multiselectable="true"
      aria-label={tr("Items")} tabIndex={0}
      onFocus={(e) => { if (e.target === e.currentTarget && items[0] && !selected.size) document.getElementById("tile-" + items[0].id)?.focus(); }}>
      <div style={{ height: v.getTotalSize() + GAP, position: "relative" }}>
        {band && <div className="band" style={{ left: band.x0, top: band.y0, width: band.x1 - band.x0, height: band.y1 - band.y0 }} />}
        {v.getVirtualItems().map((r) => (
          <div key={r.key} className="grid-row" style={{ transform: `translateY(${r.start + GAP}px)`, gap: GAP, paddingInlineStart: GAP }}>
            {items.slice(r.index * cols, r.index * cols + cols).map((it) => (
              <Tile key={it.id} root={root} item={it} size={size} selected={selected.has(it.id)}
                selectedIds={selected} onSelect={onSelect} onOpen={onOpen} onContext={onContext} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
