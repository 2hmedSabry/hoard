export type Kind = "image" | "video" | "audio" | "document" | "font" | "other";
export type Swatch = { hex: string; ratio: number };
export type Item = {
  id: string; name: string; ext: string; kind: Kind; fileName: string; size: number;
  width: number; height: number; tags: string[]; folders: string[]; rating: number;
  note: string; url: string; palette: Swatch[]; createdAt: number; modifiedAt: number;
  deleted: boolean; thumb: string | null; duration: number | null;
  camera?: CameraInfo | null;
  fhash?: string; dhash?: string; annotations?: Annotation[]; labels?: string[]; ocr?: string; analyzed?: boolean;
};
export type CameraInfo = { camera: string | null; lens: string | null; takenAt: number | null; exposure: string | null; aperture: string | null; iso: string | null; focalLength: string | null };
export type Annotation = { id: string; x: number; y: number; w: number; h: number; text: string; createdAt: number };
export type Rule = { field: string; op: string; value: string };
export type SmartFolder = { id: string; name: string; matchMode: "all" | "any"; rules: Rule[] };
export type WatchedFolder = { id: string; path: string; folderId: string | null; enabled: boolean };
export type DupGroup = { reason: "exact" | "similar"; items: Item[] };
export type Folder = { id: string; name: string; color?: string | null; children: Folder[] };
export type TagGroup = { id: string; name: string; color: string | null; tags: string[] };
export type LibraryInfo = { root: string; meta: { name: string; version: number; folders: Folder[]; smartFolders: SmartFolder[]; watched: WatchedFolder[]; tagGroups: TagGroup[]; createdAt: number } };
export type Stats = {
  all: number; uncategorized: number; untagged: number; trash: number;
  folders: Record<string, number>; smart: Record<string, number>; aiPending: number; tags: [string, number][];
};
export type Scope = "all" | "uncategorized" | "untagged" | "trash" | "folder" | "smart" | "duplicates" | "similar";
export type Sort = "created_desc" | "created_asc" | "modified_desc" | "name_asc" | "name_desc" | "size_desc" | "size_asc" | "rating_desc";
export type Query = {
  scope: Scope; folderId: string | null; smartFolderId: string | null; similarTo?: string | null; tags: string[]; kinds: Kind[];
  minRating: number; color: string | null; text: string; sort: Sort;
};
export type ItemPatch = Partial<{
  name: string; rating: number; note: string; url: string;
  addTags: string[]; removeTags: string[]; addFolders: string[]; removeFolders: string[];
}>;
export type ImportProgress = { done: number; total: number; failed: number; skipped: number };
