import { save, settings, status } from "./hoard.js";

const $ = (id) => document.getElementById(id);
let tab;
let found = [];
const picked = new Set();

function message(text, bad = false) {
  $("msg").textContent = text;
  $("msg").style.color = bad ? "var(--danger)" : "";
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const s = await settings();
  try {
    const st = await status();
    if (!st.library) {
      $("status").textContent = "Hoard is open but no library is loaded.";
      $("status").className = "status bad";
      return;
    }
    $("status").textContent = `Saving to “${st.library}”`;
    $("status").className = "status ok";
    for (const f of st.folders) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = "  ".repeat(f.depth) + f.name;
      $("folder").append(o);
    }
    $("folder").value = st.folders.some((f) => f.id === s.folderId) ? s.folderId : "";
    $("tags").value = s.tags;
    $("controls").hidden = false;
  } catch (e) {
    $("status").innerHTML = "";
    $("status").append(e.message + " ");
    if (e.kind === "token") {
      const a = document.createElement("a");
      a.href = "#"; a.textContent = "Open settings";
      a.onclick = () => chrome.runtime.openOptionsPage();
      $("status").append(a);
    }
    $("status").className = "status bad";
  }
}

$("folder").onchange = () => chrome.storage.local.set({ folderId: $("folder").value });
$("tags").oninput = () => chrome.storage.local.set({ tags: $("tags").value });

$("shot").onclick = async () => {
  message("Saving screenshot…");
  try {
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const r = await save({ data, fileName: `Screenshot ${stamp}.png`, pageUrl: tab.url, title: tab.title || "Screenshot" });
    message(r.status === "duplicate" ? "Already in your library." : "Screenshot saved.");
  } catch (e) { message(e.message, true); }
};

// Runs inside the page: lists images big enough to be worth saving.
function collectImages() {
  const out = new Map();
  const add = (src, w, h, alt) => {
    if (!src || src.startsWith("blob:") || w < 80 || h < 80) return;
    const prev = out.get(src);
    if (!prev || prev.w * prev.h < w * h) out.set(src, { src, w, h, alt: alt || "" });
  };
  for (const img of document.images) add(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight, img.alt);
  for (const v of document.querySelectorAll("video[poster]")) add(v.poster, v.videoWidth || 400, v.videoHeight || 300, "");
  for (const m of document.querySelectorAll('meta[property="og:image"]')) add(m.content, 1200, 630, document.title);
  return [...out.values()].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 300);
}

function renderGrid() {
  $("grid").innerHTML = "";
  for (const im of found) {
    const b = document.createElement("button");
    b.className = "pic" + (picked.has(im.src) ? " on" : "");
    b.title = im.alt || im.src;
    const img = document.createElement("img");
    img.src = im.src; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    const size = document.createElement("span");
    size.textContent = `${im.w}×${im.h}`;
    b.append(img, size);
    b.onclick = () => { picked.has(im.src) ? picked.delete(im.src) : picked.add(im.src); renderGrid(); };
    $("grid").append(b);
  }
  $("count").textContent = `${found.length} image${found.length === 1 ? "" : "s"} · ${picked.size} selected`;
  $("savePicked").disabled = !picked.size;
  $("savePicked").textContent = picked.size ? `Save ${picked.size} selected` : "Save selected";
}

$("pick").onclick = async () => {
  message("");
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectImages });
    found = res?.result ?? [];
    picked.clear();
    $("picker").hidden = false;
    if (!found.length) message("No images of a useful size on this page.");
    renderGrid();
  } catch {
    message("This page can't be read (browser pages and the Web Store are off limits).", true);
  }
};

$("all").onclick = () => {
  if (picked.size === found.length) picked.clear(); else found.forEach((f) => picked.add(f.src));
  renderGrid();
};

$("savePicked").onclick = async () => {
  const list = found.filter((f) => picked.has(f.src));
  let ok = 0, dup = 0, bad = 0;
  $("savePicked").disabled = true;
  for (const [i, im] of list.entries()) {
    message(`Saving ${i + 1} of ${list.length}…`);
    try {
      const item = im.src.startsWith("data:") ? { data: im.src } : { url: im.src };
      const r = await save({ ...item, pageUrl: tab.url, title: im.alt || tab.title });
      r.status === "duplicate" ? dup++ : ok++;
    } catch { bad++; }
  }
  message(`Saved ${ok}${dup ? ` · ${dup} already in library` : ""}${bad ? ` · ${bad} failed` : ""}.`, bad > 0 && ok === 0);
  picked.clear();
  renderGrid();
};

init();
