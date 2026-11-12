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
};

const GAP = 14;
const LABEL = 40;

const Tile = memo(function Tile({ root, item, size, selected, selectedIds, onSelect, onOpen }: {
  root: string; item: Item; size: number; selected: boolean; selectedIds: Set<string>;
  onSelect: Props["onSelect"]; onOpen: Props["onOpen"];
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

export default function Grid({ root, items, selected, thumbSize, onSelect, onClear, onOpen, emptyHint, onCols, focusId }: Props) {
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
    <div className="grid" ref={scroller} onClick={onClear} role="listbox" aria-multiselectable="true"
      aria-label={tr("Items")} tabIndex={0}
      onFocus={(e) => { if (e.target === e.currentTarget && items[0] && !selected.size) document.getElementById("tile-" + items[0].id)?.focus(); }}>
      <div style={{ height: v.getTotalSize() + GAP, position: "relative" }}>
        {v.getVirtualItems().map((r) => (
          <div key={r.key} className="grid-row" style={{ transform: `translateY(${r.start + GAP}px)`, gap: GAP, paddingInlineStart: GAP }}>
            {items.slice(r.index * cols, r.index * cols + cols).map((it) => (
              <Tile key={it.id} root={root} item={it} size={size} selected={selected.has(it.id)}
                selectedIds={selected} onSelect={onSelect} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
