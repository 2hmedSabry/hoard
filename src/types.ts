export type Kind = "image" | "video" | "audio" | "document" | "font" | "other";
export type Swatch = { hex: string; ratio: number };
export type Item = {
  id: string; name: string; ext: string; kind: Kind; fileName: string; size: number;
  width: number; height: number; tags: string[]; folders: string[]; rating: number;
  note: string; url: string; palette: Swatch[]; createdAt: number; modifiedAt: number;
  deleted: boolean; thumb: string | null; duration: number | null;
};
export type Folder = { id: string; name: string; children: Folder[] };
export type LibraryInfo = { root: string; meta: { name: string; version: number; folders: Folder[]; createdAt: number } };
export type Stats = {
  all: number; uncategorized: number; untagged: number; trash: number;
  folders: Record<string, number>; tags: [string, number][];
};
export type Scope = "all" | "uncategorized" | "untagged" | "trash" | "folder";
export type Sort = "created_desc" | "created_asc" | "modified_desc" | "name_asc" | "name_desc" | "size_desc" | "size_asc" | "rating_desc";
export type Query = {
  scope: Scope; folderId: string | null; tags: string[]; kinds: Kind[];
  minRating: number; color: string | null; text: string; sort: Sort;
};
export type ItemPatch = Partial<{
  name: string; rating: number; note: string; url: string;
  addTags: string[]; removeTags: string[]; addFolders: string[]; removeFolders: string[];
}>;
export type ImportProgress = { done: number; total: number; failed: number };
