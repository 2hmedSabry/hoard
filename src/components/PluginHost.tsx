import { useEffect, useMemo, useRef } from "react";
import { api, fileUrl, thumbUrl } from "../api";
import { getLang, t as tr } from "../i18n";
import type { Item, ItemPatch, Kind } from "../types";

export type PluginInfo = { id: string; name: string; version: string; description: string; author: string; main: string; permissions: string[] };

type Props = {
  plugin: PluginInfo; html: string; root: string; selected: Item[];
  onChanged: () => void; onNotice: (m: string) => void; onClose: () => void;
};

// Injected at the top of every plugin page: `window.hoard`, a promise-based API over postMessage.
const SDK = `<script>
(function () {
  var seq = 0, waiting = {};
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__hoard !== 1 || !waiting[m.id]) return;
    var w = waiting[m.id]; delete waiting[m.id];
    if (m.error) w[1](new Error(m.error)); else w[0](m.result);
  });
  function call(method, params) {
    return new Promise(function (res, rej) {
      var id = ++seq; waiting[id] = [res, rej];
      parent.postMessage({ __hoard: 1, id: id, method: method, params: params || {} }, "*");
    });
  }
  window.hoard = {
    selection: function () { return call("selection"); },
    search: function (q) { return call("search", q); },
    update: function (ids, patch) { return call("update", { ids: ids, patch: patch }); },
    notify: function (message) { return call("notify", { message: message }); },
    close: function () { return call("close"); }
  };
})();
</script>`;

function themeStyle() {
  const cs = getComputedStyle(document.documentElement);
  const vars = ["--bg", "--panel", "--surface", "--line", "--text", "--muted", "--accent", "--danger"]
    .map((v) => `${v}: ${cs.getPropertyValue(v).trim()};`).join(" ");
  return `<style>:root { ${vars} color-scheme: ${document.documentElement.dataset.theme === "light" ? "light" : "dark"}; }
body { margin: 0; background: var(--panel); color: var(--text); font: 13px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }</style>`;
}

const PATCH_KEYS = new Set(["name", "rating", "note", "url", "addTags", "removeTags"]);

export default function PluginHost({ plugin, html, root, selected, onChanged, onNotice, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const can = (p: string) => plugin.permissions.includes(p);
  const view = (it: Item) => ({
    id: it.id, name: it.name, ext: it.ext, kind: it.kind, width: it.width, height: it.height, size: it.size,
    tags: it.tags, rating: it.rating, note: it.note, url: it.url, palette: it.palette, labels: it.labels ?? [],
    text: it.ocr ?? "", createdAt: it.createdAt, thumbUrl: thumbUrl(root, it), fileUrl: fileUrl(root, it),
  });
  const selRef = useRef(selected);
  selRef.current = selected;

  const srcDoc = useMemo(() => {
    const head = `<meta charset="utf-8"><meta name="hoard-lang" content="${getLang()}">${themeStyle()}${SDK}`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html;
  }, [html]);

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data;
      if (!m || m.__hoard !== 1) return;
      const reply = (body: object) => frame.current?.contentWindow?.postMessage({ __hoard: 1, id: m.id, ...body }, "*");
      try {
        switch (m.method) {
          case "selection":
            if (!can("read")) throw new Error("This plugin didn't ask for the read permission");
            return reply({ result: selRef.current.map(view) });
          case "search": {
            if (!can("read")) throw new Error("This plugin didn't ask for the read permission");
            const q = m.params ?? {};
            const items = await api.query({
              scope: "all", folderId: null, smartFolderId: null, sort: "created_desc", color: null,
              text: String(q.text ?? ""), tags: Array.isArray(q.tags) ? q.tags.map(String) : [],
              kinds: Array.isArray(q.kinds) ? (q.kinds as Kind[]) : [], minRating: Number(q.minRating) || 0,
            });
            return reply({ result: items.slice(0, 500).map(view) });
          }
          case "update": {
            if (!can("write")) throw new Error("This plugin didn't ask for the write permission");
            const ids: string[] = Array.isArray(m.params?.ids) ? m.params.ids.map(String).slice(0, 5000) : [];
            const patch: ItemPatch = {};
            for (const [k, v] of Object.entries(m.params?.patch ?? {})) if (PATCH_KEYS.has(k)) (patch as Record<string, unknown>)[k] = v;
            const changed = await api.update(ids, patch);
            onChanged();
            return reply({ result: changed.length });
          }
          case "notify":
            onNotice(`${plugin.name}: ${String(m.params?.message ?? "").slice(0, 300)}`);
            return reply({ result: true });
          case "close":
            onClose();
            return reply({ result: true });
          default:
            throw new Error(`Unknown method ${m.method}`);
        }
      } catch (err) {
        reply({ error: String((err as Error)?.message ?? err) });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [plugin, onChanged, onNotice, onClose]); // eslint-disable-line

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal plugin-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="plugin-head">
          <b>{plugin.name}</b>
          <span className="muted small">{plugin.version && `v${plugin.version}`} {plugin.author && `· ${plugin.author}`}</span>
          <span className="grow" />
          <span className="muted small">{tr("{n} selected", { n: selected.length })}</span>
          <button onClick={onClose}>{tr("Close (Esc)")}</button>
        </div>
        {/* Scripts only: no same-origin, forms, popups or navigation. */}
        <iframe ref={frame} className="plugin-frame" sandbox="allow-scripts" srcDoc={srcDoc} title={plugin.name} />
      </div>
    </div>
  );
}
