use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Swatch {
    pub hex: String,
    pub ratio: f32,
}

/// One asset. Stored as `items/<id>/item.json` (the source of truth) and
/// mirrored into `index.db` for fast search.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub ext: String,
    pub kind: String,
    pub file_name: String,
    pub size: u64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub rating: u8,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub palette: Vec<Swatch>,
    pub created_at: i64,
    pub modified_at: i64,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub thumb: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub children: Vec<Folder>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMeta {
    pub name: String,
    pub version: u32,
    #[serde(default)]
    pub folders: Vec<Folder>,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub root: String,
    pub meta: LibraryMeta,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    pub scope: String,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub kinds: Vec<String>,
    pub min_rating: u8,
    pub color: Option<String>,
    pub text: Option<String>,
    pub sort: String,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemPatch {
    pub name: Option<String>,
    pub rating: Option<u8>,
    pub note: Option<String>,
    pub url: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub add_folders: Vec<String>,
    pub remove_folders: Vec<String>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub all: i64,
    pub uncategorized: i64,
    pub untagged: i64,
    pub trash: i64,
    pub folders: std::collections::HashMap<String, i64>,
    pub tags: Vec<(String, i64)>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    pub failed: usize,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..16].to_uppercase()
}

pub fn find_folder<'a>(list: &'a [Folder], id: &str) -> Option<&'a Folder> {
    for f in list {
        if f.id == id {
            return Some(f);
        }
        if let Some(x) = find_folder(&f.children, id) {
            return Some(x);
        }
    }
    None
}

pub fn find_folder_mut<'a>(list: &'a mut Vec<Folder>, id: &str) -> Option<&'a mut Folder> {
    for f in list.iter_mut() {
        if f.id == id {
            return Some(f);
        }
        if let Some(x) = find_folder_mut(&mut f.children, id) {
            return Some(x);
        }
    }
    None
}

pub fn remove_folder(list: &mut Vec<Folder>, id: &str) -> Option<Folder> {
    if let Some(pos) = list.iter().position(|f| f.id == id) {
        return Some(list.remove(pos));
    }
    for f in list.iter_mut() {
        if let Some(x) = remove_folder(&mut f.children, id) {
            return Some(x);
        }
    }
    None
}

/// The folder and every folder below it.
pub fn folder_and_descendants(f: &Folder) -> Vec<String> {
    let mut out = vec![f.id.clone()];
    for c in &f.children {
        out.extend(folder_and_descendants(c));
    }
    out
}
