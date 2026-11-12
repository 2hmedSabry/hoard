import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { DupGroup, Folder, Item, ItemPatch, LibraryInfo, Query, Rule, SmartFolder, Stats } from "./types";

export const api = {
  openLastLibrary: () => invoke<LibraryInfo | null>("open_last_library"),
  createLibrary: (parent: string, name: string) => invoke<LibraryInfo>("create_library", { parent, name }),
  openLibrary: (path: string) => invoke<LibraryInfo>("open_library", { path }),
  libraryInfo: () => invoke<LibraryInfo>("library_info"),
  query: (query: Query) => invoke<Item[]>("query_items", { query }),
  stats: () => invoke<Stats>("library_stats"),
  update: (ids: string[], patch: ItemPatch) => invoke<Item[]>("update_items", { ids, patch }),
  setTrashed: (ids: string[], trashed: boolean) => invoke<void>("set_trashed", { ids, trashed }),
  emptyTrash: () => invoke<number>("empty_trash"),
  createFolder: (name: string, parentId: string | null) => invoke<Folder>("create_folder", { name, parentId }),
  renameFolder: (id: string, name: string) => invoke<void>("rename_folder", { id, name }),
  moveFolder: (id: string, parentId: string | null) => invoke<void>("move_folder", { id, parentId }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  createSmartFolder: (name: string, matchMode: string, rules: Rule[]) => invoke<SmartFolder>("create_smart_folder", { name, matchMode, rules }),
  updateSmartFolder: (id: string, name: string, matchMode: string, rules: Rule[]) => invoke<void>("update_smart_folder", { id, name, matchMode, rules }),
  deleteSmartFolder: (id: string) => invoke<void>("delete_smart_folder", { id }),
  findDuplicates: (maxDistance: number) => invoke<DupGroup[]>("find_duplicates", { maxDistance }),
  renameTag: (from: string, to: string) => invoke<void>("rename_tag", { from, to }),
  rebuildIndex: () => invoke<number>("rebuild_index"),
  reveal: (id: string) => invoke<void>("reveal_item", { id }),
  open: (id: string) => invoke<void>("open_item", { id }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  importPaths: (paths: string[], folderId: string | null) => invoke<number>("import_paths", { paths, folderId }),
};

export const fileUrl = (root: string, it: Item) => convertFileSrc(`${root}/items/${it.id}/${it.fileName}`);
export const thumbUrl = (root: string, it: Item) =>
  it.thumb ? convertFileSrc(`${root}/items/${it.id}/${it.thumb}`) + `?v=${it.modifiedAt}` : null;

export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(s: number | null) {
  if (s == null) return "";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function flattenFolders(list: Folder[], depth = 0, out: { f: Folder; depth: number }[] = []) {
  for (const f of list) { out.push({ f, depth }); flattenFolders(f.children, depth + 1, out); }
  return out;
}

