import { t as tr } from "../i18n";
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
    const ok = await ask(tr("Make a new token? The extension stops working until you paste the new one into its settings."), { title: tr("New token"), okLabel: tr("Make new token"), cancelLabel: tr("Cancel") });
    if (!ok) return;
    try { const token = await api.regenerateApiToken(); setInfo((i) => (i ? { ...i, token } : i)); setShown(true); } catch (e) { fail(e); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{tr("Browser extension")}</h3>
        <p className="muted">{tr("Save images, videos and screenshots from Chrome, Edge, Brave or Arc straight into the open library.")}</p>
        {info && (
          <p className={info.running ? "ok-line" : "error"}>
            {info.running ? "● " + tr("Hoard is listening on {addr} (this computer only)", { addr: `127.0.0.1:${info.port}` }) : info.error ?? tr("Starting…")}
          </p>
        )}
        <label className="field"><span>{tr("Connection token")}</span>
          <div className="token-row">
            <input readOnly type={shown ? "text" : "password"} value={info?.token ?? ""} onFocus={(e) => e.target.select()} />
            <button onClick={() => setShown(!shown)}>{shown ? tr("Hide") : tr("Show")}</button>
            <button className="primary" onClick={copy}>{copied ? tr("Copied") : tr("Copy")}</button>
          </div>
        </label>
        <ol className="steps">
          <li>{tr("Open")} <code>chrome://extensions</code> and turn on <b>{tr("Developer mode")}</b>.</li>
          <li>{tr("Click")} <b>{tr("Load unpacked")}</b> and choose the <code>extension</code> folder from the Hoard source.</li>
          <li>{tr("Open the extension's")} <b>{tr("Options")}</b>, paste the token, and click <b>{tr("Connect")}</b>.</li>
          <li>{tr("Right-click any image and choose")} <b>{tr("Save to Hoard")}</b>, or use the toolbar button.</li>
        </ol>
        <p className="muted small">{tr("Only the extension holding this token can add files. Web pages can't reach Hoard.")}</p>
        <div className="modal-actions">
          <button className="link" onClick={renew}>{tr("Make a new token")}</button>
          <span className="grow" />
          <button onClick={onClose}>{tr("Done")}</button>
        </div>
      </div>
    </div>
  );
}
