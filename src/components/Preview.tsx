import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { api, fileUrl, thumbUrl } from "../api";
import type { Item } from "../types";
import Annotator from "./Annotator";
import { AudioViewer, FontViewer, TextViewer } from "./Viewers";

type Props = { root: string; items: Item[]; id: string; onNavigate: (id: string) => void; onClose: () => void; onItemChanged: (it: Item) => void; fail: (e: unknown) => void };

export default function Preview({ root, items, id, onNavigate, onClose, onItemChanged, fail }: Props) {
  const idx = items.findIndex((i) => i.id === id);
  const item = items[idx];
  const [actual, setActual] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [every, setEvery] = useState(4);

  // Slideshow: move to the next item every few seconds, looping at the end.
  useEffect(() => {
    if (!playing || items.length < 2) return;
    const t = setTimeout(() => onNavigate(items[(idx + 1) % items.length].id), every * 1000);
    return () => clearTimeout(t);
  }, [playing, idx, items, every, onNavigate]);

  useEffect(() => { setActual(false); }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "Escape" || e.key === " ") { e.preventDefault(); if (playing && e.key === " ") setPlaying(false); else onClose(); }
      else if (e.key === "p") setPlaying((v) => !v);
      else if (e.key === "ArrowRight" && idx < items.length - 1) onNavigate(items[idx + 1].id);
      else if (e.key === "ArrowLeft" && idx > 0) onNavigate(items[idx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, items, onClose, onNavigate, playing]);

  if (!item) return null;
  const src = fileUrl(root, item);
  const thumb = thumbUrl(root, item);
  const browserImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico", "heic", "tif", "tiff"].includes(item.ext);

  let body: React.ReactNode;
  if (item.kind === "image" && browserImage) {
    body = actual
      ? <img className="actual" src={src} onClick={() => setActual(false)} title={tr("Click to fit")} />
      : <Annotator src={src} annotations={item.annotations ?? []} editing={annotating}
          onSave={(list) => api.setAnnotations(item.id, list).then(onItemChanged).catch(fail)} />;
  } else if (item.kind === "video") {
    body = <video src={src} controls autoPlay loop />;
  } else if (item.kind === "audio") {
    body = <AudioViewer src={src} cover={thumb} />;
  } else if (item.kind === "font" && ["ttf", "otf", "woff", "woff2"].includes(item.ext)) {
    body = <FontViewer src={src} item={item} />;
  } else if (["txt", "md", "csv", "json", "log", "xml", "yml", "yaml"].includes(item.ext)) {
    body = <TextViewer src={src} />;
  } else if (item.ext === "pdf") {
    body = <iframe src={src} title={item.name} />;
  } else if (thumb) {
    body = <img className="fit" src={thumb} />;
  } else {
    body = <div className="ext-tile large">{item.ext.toUpperCase()}</div>;
  }

  return (
    <div className="preview" onClick={onClose}>
      <div className="preview-bar" onClick={(e) => e.stopPropagation()}>
        <span className="name">{item.name}</span>
        <span className="muted">{idx + 1} / {items.length}</span>
        <span className="grow" />
        {item.kind === "image" && browserImage && <>
          <button className={annotating ? "primary" : ""} onClick={() => { setAnnotating(!annotating); setActual(false); }}
            title={tr("Drag on the picture to comment on an area")}>{annotating ? tr("Done commenting") : tr("Comment on area") + (item.annotations?.length ? ` (${item.annotations.length})` : "")}</button>
          <button onClick={() => { setActual(!actual); setAnnotating(false); }}>{actual ? tr("Fit") : "100%"}</button>
        </>}
        {items.length > 1 && <>
          <button className={playing ? "primary" : ""} onClick={() => setPlaying(!playing)} title={tr("Slideshow (P)")}>{playing ? "❚❚ " + tr("Pause") : "▶ " + tr("Slideshow")}</button>
          {playing && <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {[2, 4, 8, 15].map((n) => <option key={n} value={n}>{n}s</option>)}
          </select>}
        </>}
        <button onClick={() => api.open(item.id)}>{tr("Open in default app")}</button>
        <button onClick={onClose}>{tr("Close (Esc)")}</button>
      </div>
      <div className={`preview-body${actual ? " scroll" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="preview-content" onClick={(e) => e.stopPropagation()}>{body}</div>
      </div>
      {idx > 0 && <button className="nav prev" onClick={(e) => { e.stopPropagation(); onNavigate(items[idx - 1].id); }}>‹</button>}
      {idx < items.length - 1 && <button className="nav next" onClick={(e) => { e.stopPropagation(); onNavigate(items[idx + 1].id); }}>›</button>}
    </div>
  );
}
