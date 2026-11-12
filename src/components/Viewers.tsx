import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { Item } from "../types";

/** Loads the font file and shows it at several sizes with an editable sample. */
export function FontViewer({ src, item }: { src: string; item: Item }) {
  const family = `hoard-font-${item.id}`;
  const [ready, setReady] = useState<"loading" | "ok" | "bad">("loading");
  const [sample, setSample] = useState(tr("The quick brown fox jumps over the lazy dog"));
  const [size, setSize] = useState(48);

  useEffect(() => {
    let cancelled = false;
    const face = new FontFace(family, `url("${src}")`);
    face.load().then((f) => { if (!cancelled) { document.fonts.add(f); setReady("ok"); } }).catch(() => !cancelled && setReady("bad"));
    return () => { cancelled = true; };
  }, [src, family]);

  if (ready === "bad") return <div className="ext-tile large">{item.ext.toUpperCase()}</div>;
  return (
    <div className="font-view" style={{ fontFamily: `"${family}", system-ui` }} onClick={(e) => e.stopPropagation()}>
      <div className="font-tools">
        <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder={tr("Type to preview")} style={{ fontFamily: "inherit" }} />
        <input type="range" min={12} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        <span className="muted">{size}px</span>
      </div>
      {ready === "loading" ? <p className="muted">{tr("Loading font…")}</p> : <>
        <div className="font-sample" style={{ fontSize: size }}>{sample || " "}</div>
        <div className="font-glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />abcdefghijklmnopqrstuvwxyz<br />0123456789 !?&amp;@#%()[]{"{}"}.,;:</div>
        <div className="font-glyphs" dir="rtl">أبجد هوز حطي كلمن سعفص قرشت ثخذ ضظغ ١٢٣٤٥٦٧٨٩٠</div>
        {[14, 20, 32].map((s) => <div key={s} style={{ fontSize: s }} className="font-line"><span className="muted">{s}</span>{sample}</div>)}
      </>}
    </div>
  );
}

/** Waveform drawn from the decoded audio; click to seek. */
export function AudioViewer({ src, cover }: { src: string; cover: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    fetch(src).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => {
      if (cancelled) return;
      const data = buf.getChannelData(0);
      const n = 600, step = Math.max(1, Math.floor(data.length / n));
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(data[j]));
        out.push(m);
      }
      const top = Math.max(...out, 0.001);
      setPeaks(out.map((v) => v / top));
    }).catch(() => !cancelled && setPeaks([])).finally(() => ctx.close());
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const g = c.getContext("2d")!;
    const styles = getComputedStyle(document.documentElement);
    const played = styles.getPropertyValue("--accent").trim(), rest = styles.getPropertyValue("--line-strong").trim();
    const w = c.width / peaks.length, mid = c.height / 2;
    peaks.forEach((p, i) => {
      g.fillStyle = i / peaks.length <= pos ? played : rest;
      const h = Math.max(1, p * mid * 0.95);
      g.fillRect(i * w, mid - h, Math.max(1, w - 1), h * 2);
    });
  }, [peaks, pos]);

  return (
    <div className="audio-view" onClick={(e) => e.stopPropagation()}>
      {cover && <img src={cover} className="audio-cover" />}
      {peaks === null ? <p className="muted">{tr("Reading audio…")}</p> : peaks.length ? (
        <canvas ref={canvas} className="wave" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const a = audio.current;
          if (a && a.duration) a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
        }} />
      ) : null}
      <audio ref={audio} src={src} controls autoPlay onTimeUpdate={(e) => {
        const a = e.currentTarget; setPos(a.duration ? a.currentTime / a.duration : 0);
      }} />
    </div>
  );
}

/** Plain text, Markdown, CSV and JSON files (first 256 KB). */
export function TextViewer({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(src).then((r) => r.text()).then((t) => !cancelled && setText(t.length > 262144 ? t.slice(0, 262144) + "\n…" : t)).catch(() => !cancelled && setText(""));
    return () => { cancelled = true; };
  }, [src]);
  return <pre className="text-view" dir="auto" onClick={(e) => e.stopPropagation()}>{text ?? tr("Loading…")}</pre>;
}
