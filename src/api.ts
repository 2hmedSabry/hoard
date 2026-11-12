import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { PluginInfo } from "./components/PluginHost";
import type { Annotation, DupGroup, Folder, Item, ItemPatch, LibraryInfo, Query, Rule, SmartFolder, Stats } from "./types";

export type ApiInfo = { port: number; token: string; running: boolean; error: string | null };

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
  apiInfo: () => invoke<ApiInfo>("api_info"),
  regenerateApiToken: () => invoke<string>("regenerate_api_token"),
  addWatchedFolder: (path: string, folderId: string | null) => invoke<void>("add_watched_folder", { path, folderId }),
  updateWatchedFolder: (id: string, enabled: boolean, folderId: string | null) => invoke<void>("update_watched_folder", { id, enabled, folderId }),
  removeWatchedFolder: (id: string) => invoke<void>("remove_watched_folder", { id }),
  renameItems: (names: [string, string][]) => invoke<void>("rename_items", { names }),
  transformItems: (ids: string[], op: "cw" | "ccw" | "flip_h" | "flip_v") => invoke<Item[]>("transform_items", { ids, op }),
  exportPack: (ids: string[], dest: string) => invoke<number>("export_pack", { ids, dest }),
  exportFiles: (ids: string[], dest: string) => invoke<number>("export_files", { ids, dest }),
  importPack: (path: string) => invoke<[number, number]>("import_pack", { path }),
  setAnnotations: (id: string, annotations: Annotation[]) => invoke<Item>("set_annotations", { id, annotations }),
  similar: (id: string) => invoke<Item[]>("similar_items", { id }),
  listPlugins: () => invoke<PluginInfo[]>("list_plugins"),
  pluginHtml: (id: string) => invoke<string>("plugin_html", { id }),
  installPlugin: (path: string) => invoke<PluginInfo>("install_plugin", { path }),
  removePlugin: (id: string) => invoke<void>("remove_plugin", { id }),
  revealPluginsFolder: () => invoke<void>("reveal_plugins_folder"),
  setFolderColor: (id: string, color: string | null) => invoke<void>("set_folder_color", { id, color }),
  saveTagGroup: (id: string, name: string, color: string | null) => invoke<void>("save_tag_group", { id, name, color }),
  deleteTagGroup: (id: string) => invoke<void>("delete_tag_group", { id }),
  setTagGroup: (tag: string, groupId: string | null) => invoke<void>("set_tag_group", { tag, groupId }),
  cropItem: (id: string, x: number, y: number, w: number, h: number) => invoke<Item>("crop_item", { id, x, y, w, h }),
  lockFolder: (id: string, password: string) => invoke<void>("lock_folder", { id, password }),
  unlockFolder: (id: string, password: string) => invoke<boolean>("unlock_folder", { id, password }),
  relockFolder: (id: string) => invoke<void>("relock_folder", { id }),
  removeFolderLock: (id: string, password: string) => invoke<boolean>("remove_folder_lock", { id, password }),
  unlockedFolders: () => invoke<string[]>("unlocked_folders"),
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

