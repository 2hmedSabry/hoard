import { useEffect, useState } from "react";
import { api, fileUrl, thumbUrl } from "../api";
import type { Item } from "../types";
import Annotator from "./Annotator";

type Props = { root: string; items: Item[]; id: string; onNavigate: (id: string) => void; onClose: () => void; onItemChanged: (it: Item) => void; fail: (e: unknown) => void };

export default function Preview({ root, items, id, onNavigate, onClose, onItemChanged, fail }: Props) {
  const idx = items.findIndex((i) => i.id === id);
  const item = items[idx];
  const [actual, setActual] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  useEffect(() => { setActual(false); }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === "Escape" || e.key === " ") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && idx < items.length - 1) onNavigate(items[idx + 1].id);
      else if (e.key === "ArrowLeft" && idx > 0) onNavigate(items[idx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, items, onClose, onNavigate]);

  if (!item) return null;
  const src = fileUrl(root, item);
  const thumb = thumbUrl(root, item);
  const browserImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "ico", "heic", "tif", "tiff"].includes(item.ext);

  let body: React.ReactNode;
  if (item.kind === "image" && browserImage) {
    body = actual
      ? <img className="actual" src={src} onClick={() => setActual(false)} title="Click to fit" />
      : <Annotator src={src} annotations={item.annotations ?? []} editing={annotating}
          onSave={(list) => api.setAnnotations(item.id, list).then(onItemChanged).catch(fail)} />;
  } else if (item.kind === "video") {
    body = <video src={src} controls autoPlay loop />;
  } else if (item.kind === "audio") {
    body = <div className="audio">{thumb && <img src={thumb} />}<audio src={src} controls autoPlay /></div>;
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
            title="Drag on the picture to comment on an area">{annotating ? "Done commenting" : `Comment on area${item.annotations?.length ? ` (${item.annotations.length})` : ""}`}</button>
          <button onClick={() => { setActual(!actual); setAnnotating(false); }}>{actual ? "Fit" : "100%"}</button>
        </>}
        <button onClick={() => api.open(item.id)}>Open in default app</button>
        <button onClick={onClose}>Close (Esc)</button>
      </div>
      <div className={`preview-body${actual ? " scroll" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="preview-content" onClick={(e) => e.stopPropagation()}>{body}</div>
      </div>
      {idx > 0 && <button className="nav prev" onClick={(e) => { e.stopPropagation(); onNavigate(items[idx - 1].id); }}>‹</button>}
      {idx < items.length - 1 && <button className="nav next" onClick={(e) => { e.stopPropagation(); onNavigate(items[idx + 1].id); }}>›</button>}
    </div>
  );
}
