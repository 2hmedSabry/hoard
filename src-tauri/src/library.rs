//! A library is a folder `Name.hoard/` with `library.json`, `items/<id>/` and a
//! rebuildable SQLite search index `index.db`.
use crate::model::*;
use crate::palette;
use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{params, Connection, ToSql};
use std::fs;
use std::path::{Path, PathBuf};

const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS items(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, ext TEXT, kind TEXT, size INTEGER, width INTEGER, height INTEGER,
  rating INTEGER, created_at INTEGER, modified_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item_tags(item_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(item_id, tag));
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag);
CREATE TABLE IF NOT EXISTS item_folders(item_id TEXT NOT NULL, folder_id TEXT NOT NULL, PRIMARY KEY(item_id, folder_id));
CREATE INDEX IF NOT EXISTS idx_item_folders_folder ON item_folders(folder_id);
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(id UNINDEXED, name, note, tags, url, ext,
  tokenize='unicode61 remove_diacritics 2');
";

pub struct Library {
    pub root: PathBuf,
    pub meta: LibraryMeta,
    db: Connection,
}

pub fn write_json<T: serde::Serialize>(path: &Path, v: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn upsert(c: &Connection, it: &Item) -> Result<()> {
    c.execute(
        "INSERT OR REPLACE INTO items(id,name,ext,kind,size,width,height,rating,created_at,modified_at,deleted,json)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            it.id, it.name, it.ext, it.kind, it.size as i64, it.width, it.height, it.rating,
            it.created_at, it.modified_at, it.deleted as i64, serde_json::to_string(it)?
        ],
    )?;
    remove_index_rows(c, &it.id, false)?;
    for t in &it.tags {
        c.execute("INSERT OR IGNORE INTO item_tags VALUES(?1,?2)", params![it.id, t])?;
    }
    for f in &it.folders {
        c.execute("INSERT OR IGNORE INTO item_folders VALUES(?1,?2)", params![it.id, f])?;
    }
    c.execute(
        "INSERT INTO items_fts(id,name,note,tags,url,ext) VALUES(?1,?2,?3,?4,?5,?6)",
        params![it.id, it.name, it.note, it.tags.join(" "), it.url, it.ext],
    )?;
    Ok(())
}

fn remove_index_rows(c: &Connection, id: &str, with_item: bool) -> Result<()> {
    c.execute("DELETE FROM item_tags WHERE item_id=?1", [id])?;
    c.execute("DELETE FROM item_folders WHERE item_id=?1", [id])?;
    c.execute("DELETE FROM items_fts WHERE id=?1", [id])?;
    if with_item {
        c.execute("DELETE FROM items WHERE id=?1", [id])?;
    }
    Ok(())
}

/// Each word becomes a prefix match, so "sun bea" finds "Sunset beach".
fn fts_query(text: &str) -> String {
    text.split_whitespace()
        .map(|w| w.replace('"', ""))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

impl Library {
    pub fn create(parent: &Path, name: &str) -> Result<Self> {
        let clean: String = name.trim().chars().filter(|c| !matches!(c, '/' | '\\' | ':')).collect();
        if clean.is_empty() {
            bail!("Please enter a library name");
        }
        let root = parent.join(format!("{clean}.hoard"));
        if root.exists() {
            bail!("A library named \"{clean}\" already exists in that folder");
        }
        fs::create_dir_all(root.join("items"))?;
        let meta = LibraryMeta { name: clean, version: 1, folders: vec![], created_at: now_ms() };
        write_json(&root.join("library.json"), &meta)?;
        Self::open(&root)
    }

    pub fn open(root: &Path) -> Result<Self> {
        let text = fs::read_to_string(root.join("library.json"))
            .with_context(|| format!("{} is not a Hoard library", root.display()))?;
        let meta: LibraryMeta = serde_json::from_str(&text).context("library.json is damaged")?;
        fs::create_dir_all(root.join("items"))?;
        let db_path = root.join("index.db");
        let fresh = !db_path.exists();
        let db = Connection::open(&db_path)?;
        db.execute_batch(SCHEMA)?;
        let mut lib = Library { root: root.to_path_buf(), meta, db };
        if fresh {
            lib.rebuild_index()?;
        }
        Ok(lib)
    }

    pub fn info(&self) -> LibraryInfo {
        LibraryInfo { root: self.root.to_string_lossy().into(), meta: self.meta.clone() }
    }

    fn save_meta(&self) -> Result<()> {
        write_json(&self.root.join("library.json"), &self.meta)
    }

    pub fn item_dir(&self, id: &str) -> PathBuf {
        self.root.join("items").join(id)
    }

    /// Re-reads every `item.json`; the index can always be thrown away.
    pub fn rebuild_index(&mut self) -> Result<usize> {
        let items_dir = self.root.join("items");
        let tx = self.db.transaction()?;
        tx.execute_batch("DELETE FROM items; DELETE FROM item_tags; DELETE FROM item_folders; DELETE FROM items_fts;")?;
        let mut n = 0;
        for entry in fs::read_dir(&items_dir)?.flatten() {
            if let Ok(s) = fs::read_to_string(entry.path().join("item.json")) {
                if let Ok(item) = serde_json::from_str::<Item>(&s) {
                    upsert(&tx, &item)?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn index_items(&mut self, items: &[Item]) -> Result<()> {
        let tx = self.db.transaction()?;
        for it in items {
            upsert(&tx, it)?;
        }
        tx.commit()?;
        Ok(())
    }

    fn save_items(&mut self, items: &[Item]) -> Result<()> {
        for it in items {
            write_json(&self.item_dir(&it.id).join("item.json"), it)?;
        }
        self.index_items(items)
    }

    pub fn get(&self, id: &str) -> Result<Item> {
        let json: String = self
            .db
            .query_row("SELECT json FROM items WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| anyhow!("Item {id} not found"))?;
        Ok(serde_json::from_str(&json)?)
    }

    fn ids_where(&self, sql: &str, arg: &str) -> Result<Vec<String>> {
        let mut st = self.db.prepare(sql)?;
        let rows = st.query_map([arg], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn query(&self, q: &Query) -> Result<Vec<Item>> {
        let mut sql = String::from("SELECT json FROM items WHERE deleted=?");
        let mut args: Vec<Box<dyn ToSql>> = vec![Box::new((q.scope == "trash") as i64)];
        match q.scope.as_str() {
            "uncategorized" => sql.push_str(" AND id NOT IN (SELECT item_id FROM item_folders)"),
            "untagged" => sql.push_str(" AND id NOT IN (SELECT item_id FROM item_tags)"),
            "folder" => {
                let ids = q
                    .folder_id
                    .as_deref()
                    .and_then(|id| find_folder(&self.meta.folders, id))
                    .map(folder_and_descendants)
                    .unwrap_or_default();
                if ids.is_empty() {
                    return Ok(vec![]);
                }
                let ph = vec!["?"; ids.len()].join(",");
                sql.push_str(&format!(" AND id IN (SELECT item_id FROM item_folders WHERE folder_id IN ({ph}))"));
                args.extend(ids.into_iter().map(|i| Box::new(i) as Box<dyn ToSql>));
            }
            _ => {}
        }
        for t in &q.tags {
            sql.push_str(" AND id IN (SELECT item_id FROM item_tags WHERE tag=?)");
            args.push(Box::new(t.clone()));
        }
        if !q.kinds.is_empty() {
            sql.push_str(&format!(" AND kind IN ({})", vec!["?"; q.kinds.len()].join(",")));
            args.extend(q.kinds.iter().map(|k| Box::new(k.clone()) as Box<dyn ToSql>));
        }
        if q.min_rating > 0 {
            sql.push_str(" AND rating>=?");
            args.push(Box::new(q.min_rating as i64));
        }
        if let Some(m) = q.text.as_deref().map(fts_query).filter(|m| !m.is_empty()) {
            sql.push_str(" AND id IN (SELECT id FROM items_fts WHERE items_fts MATCH ?)");
            args.push(Box::new(m));
        }
        sql.push_str(match q.sort.as_str() {
            "created_asc" => " ORDER BY created_at ASC",
            "name_asc" => " ORDER BY name COLLATE NOCASE ASC",
            "name_desc" => " ORDER BY name COLLATE NOCASE DESC",
            "size_desc" => " ORDER BY size DESC",
            "size_asc" => " ORDER BY size ASC",
            "rating_desc" => " ORDER BY rating DESC, created_at DESC",
            "modified_desc" => " ORDER BY modified_at DESC",
            _ => " ORDER BY created_at DESC",
        });
        let mut stmt = self.db.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), |r| r.get::<_, String>(0))?;
        let target = q.color.as_deref().and_then(palette::hex_to_lab);
        let mut out = vec![];
        for row in rows {
            let it: Item = serde_json::from_str(&row?)?;
            if let Some(t) = &target {
                if !palette::matches(&it.palette, t) {
                    continue;
                }
            }
            out.push(it);
        }
        Ok(out)
    }

    pub fn stats(&self) -> Result<Stats> {
        let count = |sql: &str| -> Result<i64> { Ok(self.db.query_row(sql, [], |r| r.get(0))?) };
        let mut s = Stats {
            all: count("SELECT COUNT(*) FROM items WHERE deleted=0")?,
            uncategorized: count("SELECT COUNT(*) FROM items WHERE deleted=0 AND id NOT IN (SELECT item_id FROM item_folders)")?,
            untagged: count("SELECT COUNT(*) FROM items WHERE deleted=0 AND id NOT IN (SELECT item_id FROM item_tags)")?,
            trash: count("SELECT COUNT(*) FROM items WHERE deleted=1")?,
            ..Default::default()
        };
        let mut st = self.db.prepare(
            "SELECT folder_id, COUNT(*) FROM item_folders JOIN items ON items.id=item_id WHERE deleted=0 GROUP BY folder_id",
        )?;
        for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (k, v) = r?;
            s.folders.insert(k, v);
        }
        let mut st = self.db.prepare(
            "SELECT tag, COUNT(*) FROM item_tags JOIN items ON items.id=item_id WHERE deleted=0 GROUP BY tag ORDER BY tag COLLATE NOCASE",
        )?;
        for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            s.tags.push(r?);
        }
        Ok(s)
    }

    pub fn update_items(&mut self, ids: &[String], p: &ItemPatch) -> Result<Vec<Item>> {
        let mut changed = vec![];
        for id in ids {
            let mut it = self.get(id)?;
            if let Some(n) = p.name.as_ref().map(|n| n.trim()).filter(|n| !n.is_empty()) {
                it.name = n.to_string();
            }
            if let Some(r) = p.rating {
                it.rating = r.min(5);
            }
            if let Some(n) = &p.note {
                it.note = n.clone();
            }
            if let Some(u) = &p.url {
                it.url = u.trim().to_string();
            }
            for t in &p.add_tags {
                let t = t.trim();
                if !t.is_empty() && !it.tags.iter().any(|x| x == t) {
                    it.tags.push(t.to_string());
                }
            }
            it.tags.retain(|t| !p.remove_tags.contains(t));
            for f in &p.add_folders {
                if find_folder(&self.meta.folders, f).is_some() && !it.folders.contains(f) {
                    it.folders.push(f.clone());
                }
            }
            it.folders.retain(|f| !p.remove_folders.contains(f));
            it.modified_at = now_ms();
            changed.push(it);
        }
        self.save_items(&changed)?;
        Ok(changed)
    }

    pub fn set_trashed(&mut self, ids: &[String], trashed: bool) -> Result<()> {
        let mut changed = vec![];
        for id in ids {
            let mut it = self.get(id)?;
            it.deleted = trashed;
            it.modified_at = now_ms();
            changed.push(it);
        }
        self.save_items(&changed)
    }

    pub fn empty_trash(&mut self) -> Result<usize> {
        let ids = self.ids_where("SELECT id FROM items WHERE deleted=?1", "1")?;
        for id in &ids {
            let dir = self.item_dir(id);
            if dir.exists() {
                fs::remove_dir_all(&dir)?;
            }
            remove_index_rows(&self.db, id, true)?;
        }
        Ok(ids.len())
    }

    pub fn create_folder(&mut self, name: &str, parent: Option<&str>) -> Result<Folder> {
        let name = name.trim();
        if name.is_empty() {
            bail!("Folder name is empty");
        }
        let f = Folder { id: new_id(), name: name.into(), children: vec![] };
        match parent {
            Some(pid) => find_folder_mut(&mut self.meta.folders, pid)
                .ok_or_else(|| anyhow!("Parent folder not found"))?
                .children
                .push(f.clone()),
            None => self.meta.folders.push(f.clone()),
        }
        self.save_meta()?;
        Ok(f)
    }

    pub fn rename_folder(&mut self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            bail!("Folder name is empty");
        }
        find_folder_mut(&mut self.meta.folders, id).ok_or_else(|| anyhow!("Folder not found"))?.name = name.into();
        self.save_meta()
    }

    /// Moves a folder under another one (or to the top when `parent` is None).
    pub fn move_folder(&mut self, id: &str, parent: Option<&str>) -> Result<()> {
        if let Some(pid) = parent {
            let f = find_folder(&self.meta.folders, id).ok_or_else(|| anyhow!("Folder not found"))?;
            if folder_and_descendants(f).iter().any(|x| x == pid) {
                bail!("A folder can't go inside itself");
            }
        }
        let f = remove_folder(&mut self.meta.folders, id).ok_or_else(|| anyhow!("Folder not found"))?;
        match parent.and_then(|pid| find_folder_mut(&mut self.meta.folders, pid)) {
            Some(p) => p.children.push(f),
            None => self.meta.folders.push(f),
        }
        self.save_meta()
    }

    /// Deletes the folder and its subfolders. Items stay in the library.
    pub fn delete_folder(&mut self, id: &str) -> Result<()> {
        let f = remove_folder(&mut self.meta.folders, id).ok_or_else(|| anyhow!("Folder not found"))?;
        let gone = folder_and_descendants(&f);
        let mut affected = vec![];
        for fid in &gone {
            affected.extend(self.ids_where("SELECT item_id FROM item_folders WHERE folder_id=?1", fid)?);
        }
        affected.sort();
        affected.dedup();
        let patch = ItemPatch { remove_folders: gone, ..Default::default() };
        self.update_items(&affected, &patch)?;
        self.save_meta()
    }

    pub fn rename_tag(&mut self, from: &str, to: &str) -> Result<()> {
        let ids = self.ids_where("SELECT item_id FROM item_tags WHERE tag=?1", from)?;
        // Remove first, then add, so a rename that only changes letter case works.
        // An empty new name deletes the tag.
        self.update_items(&ids, &ItemPatch { remove_tags: vec![from.into()], ..Default::default() })?;
        let to = to.trim();
        if !to.is_empty() {
            self.update_items(&ids, &ItemPatch { add_tags: vec![to.into()], ..Default::default() })?;
        }
        Ok(())
    }

    pub fn file_path(&self, id: &str) -> Result<PathBuf> {
        let it = self.get(id)?;
        Ok(self.item_dir(id).join(it.file_name))
    }
}
