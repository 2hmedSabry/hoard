import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import type { LibraryInfo } from "../types";

type Props = { onOpen: (l: LibraryInfo) => void; error: string | null; setError: (e: string | null) => void };

export default function Welcome({ onOpen, error, setError }: Props) {
  const [name, setName] = useState("My Library");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setError(null);
    const parent = await openDialog({ directory: true, title: "Choose where to save the library" });
    if (typeof parent !== "string") return;
    setBusy(true);
    try { onOpen(await api.createLibrary(parent, name)); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const openExisting = async () => {
    setError(null);
    const path = await openDialog({ directory: true, title: "Open a .hoard library" });
    if (typeof path !== "string") return;
    setBusy(true);
    try { onOpen(await api.openLibrary(path)); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo" />
        <h1>Hoard</h1>
        <p className="muted">Keep images, videos, fonts and references in one searchable library.</p>
        <label className="field">
          <span>New library name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        </label>
        <button className="primary" disabled={busy || !name.trim()} onClick={create}>Create library…</button>
        <button disabled={busy} onClick={openExisting}>Open existing library…</button>
        {error && <p className="error">{error}</p>}
        <p className="muted small">A library is a normal folder ending in <code>.hoard</code>. Your files are copied into it and never changed.</p>
      </div>
    </div>
  );
}
