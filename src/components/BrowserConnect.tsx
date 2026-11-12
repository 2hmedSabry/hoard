import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, type ApiInfo } from "../api";

export default function BrowserConnect({ onClose, fail }: { onClose: () => void; fail: (e: unknown) => void }) {
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { api.apiInfo().then(setInfo).catch(fail); }, [fail]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const copy = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.token); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setShown(true); }
  };
  const renew = async () => {
    const ok = await ask("Make a new token? The extension stops working until you paste the new one into its settings.", { title: "New token", okLabel: "Make new token" });
    if (!ok) return;
    try { const token = await api.regenerateApiToken(); setInfo((i) => (i ? { ...i, token } : i)); setShown(true); } catch (e) { fail(e); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Browser extension</h3>
        <p className="muted">Save images, videos and screenshots from Chrome, Edge, Brave or Arc straight into the open library.</p>
        {info && (
          <p className={info.running ? "ok-line" : "error"}>
            {info.running ? `● Hoard is listening on 127.0.0.1:${info.port} (this computer only)` : info.error ?? "Starting…"}
          </p>
        )}
        <label className="field"><span>Connection token</span>
          <div className="token-row">
            <input readOnly type={shown ? "text" : "password"} value={info?.token ?? ""} onFocus={(e) => e.target.select()} />
            <button onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
            <button className="primary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </label>
        <ol className="steps">
          <li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.</li>
          <li>Click <b>Load unpacked</b> and choose the <code>extension</code> folder from the Hoard source.</li>
          <li>Open the extension's <b>Options</b>, paste the token, and click <b>Connect</b>.</li>
          <li>Right-click any image and choose <b>Save to Hoard</b>, or use the toolbar button.</li>
        </ol>
        <p className="muted small">Only the extension holding this token can add files. Web pages can't reach Hoard.</p>
        <div className="modal-actions">
          <button className="link" onClick={renew}>Make a new token</button>
          <span className="grow" />
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
