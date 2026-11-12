import { useState } from "react";
import { t as tr } from "../i18n";

type Mode = "set" | "unlock" | "remove";
type Props = { mode: Mode; folderName: string; onSubmit: (pw: string) => Promise<boolean | void>; onClose: () => void };

export default function PasswordPrompt({ mode, folderName, onSubmit, onClose }: Props) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = { set: tr("Lock “{name}”", { name: folderName }), unlock: tr("Unlock “{name}”", { name: folderName }), remove: tr("Remove the password from “{name}”", { name: folderName }) }[mode];

  const submit = async () => {
    if (mode === "set" && pw !== again) { setErr(tr("The passwords don't match.")); return; }
    setBusy(true); setErr(null);
    try {
      const ok = await onSubmit(pw);
      if (ok === false) setErr(tr("Wrong password."));
      else onClose();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <form className="modal narrow" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h3>🔒 {title}</h3>
        {mode === "set" && <p className="muted small">{tr("Items in this folder (and its subfolders) are hidden everywhere in Hoard until you unlock it. This doesn't encrypt the files on disk, and the password can't be recovered.")}</p>}
        <input type="password" autoFocus placeholder={tr("Password")} value={pw} onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }} />
        {mode === "set" && <input type="password" placeholder={tr("Repeat password")} value={again} onChange={(e) => setAgain(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }} />}
        {err && <p className="error small">{err}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>{tr("Cancel")}</button>
          <button type="submit" className="primary" disabled={busy || !pw}>{mode === "set" ? tr("Lock") : mode === "unlock" ? tr("Unlock") : tr("Remove password")}</button>
        </div>
      </form>
    </div>
  );
}
