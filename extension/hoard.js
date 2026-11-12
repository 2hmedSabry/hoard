// Talks to the Hoard desktop app on this computer.
export const BASE = "http://127.0.0.1:47821";

export async function settings() {
  const s = await chrome.storage.local.get({ token: "", folderId: "", tags: "" });
  return s;
}

export class HoardError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

async function call(path, init = {}) {
  const { token } = await settings();
  if (!token) throw new HoardError("Paste your Hoard token in the extension options first.", "token");
  let res;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
  } catch {
    throw new HoardError("Hoard isn't running. Open the Hoard app and try again.", "offline");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HoardError(body.error || "Wrong token.", "token");
  if (!res.ok) throw new HoardError(body.error || `Hoard answered ${res.status}`, "error");
  return body;
}

export const status = () => call("/v1/status");

/** item: { url? , data?, fileName?, pageUrl?, title?, tags?, folderId?, note? } */
export async function save(item) {
  const s = await settings();
  const tags = (item.tags ?? s.tags.split(",")).map((t) => t.trim()).filter(Boolean);
  return call("/v1/items", {
    method: "POST",
    body: JSON.stringify({ folderId: s.folderId || null, ...item, tags }),
  });
}
