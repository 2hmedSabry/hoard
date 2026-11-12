//! `.hoardpack` files: a zip holding chosen items (original files plus their
//! tags, ratings, notes and links) so they can be shared between libraries.
use crate::import;
use crate::library::Library;
use crate::model::{now_ms, Item, ItemPatch};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use zip::write::SimpleFileOptions;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackManifest {
    format: String,
    version: u32,
    name: String,
    created_at: i64,
    items: Vec<Item>,
}

const FORMAT: &str = "hoardpack";

pub fn export(lib: &Library, ids: &[String], dest: &Path) -> Result<usize> {
    let items: Vec<Item> = ids.iter().map(|id| lib.get(id)).collect::<Result<_>>()?;
    if items.is_empty() {
        bail!("Nothing selected to export");
    }
    let name = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Pack".into());
    let tmp = dest.with_extension("hoardpack.part");
    let mut zip = zip::ZipWriter::new(fs::File::create(&tmp).with_context(|| format!("Can't write {}", dest.display()))?);
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let deflated = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for it in &items {
        // Folders belong to the source library, so they aren't carried over.
        let src = lib.item_dir(&it.id).join(&it.file_name);
        zip.start_file(format!("items/{}/{}", it.id, it.file_name), stored)?;
        std::io::copy(&mut fs::File::open(&src)?, &mut zip)?;
    }
    let manifest = PackManifest {
        format: FORMAT.into(),
        version: 1,
        name,
        created_at: now_ms(),
        items: items.iter().cloned().map(|mut i| { i.folders.clear(); i }).collect(),
    };
    zip.start_file("pack.json", deflated)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    zip.finish()?;
    fs::rename(&tmp, dest)?;
    Ok(items.len())
}

/// Unpacks into `work`, then imports each file (skipping exact copies) and
/// restores its details. Everything lands in a new folder named after the pack.
pub fn import(lib: &mut Library, pack: &Path, work: &Path) -> Result<(usize, usize)> {
    let mut zip = zip::ZipArchive::new(fs::File::open(pack)?).context("Not a valid .hoardpack file")?;
    let manifest: PackManifest = {
        let mut f = zip.by_name("pack.json").map_err(|_| anyhow!("This pack has no pack.json"))?;
        let mut s = String::new();
        f.read_to_string(&mut s)?;
        serde_json::from_str(&s).context("pack.json is damaged")?
    };
    if manifest.format != FORMAT {
        bail!("Not a Hoard pack");
    }
    fs::create_dir_all(work)?;
    let folder = lib.create_folder(&manifest.name, None)?;
    let seen = Mutex::new(lib.file_hashes()?);
    let (mut added, mut skipped) = (0, 0);
    for it in &manifest.items {
        // Only take entries named in the manifest, and never trust paths inside the zip.
        let entry_name = format!("items/{}/{}", it.id, it.file_name);
        let safe_name = Path::new(&it.file_name).file_name().ok_or_else(|| anyhow!("Bad file name in pack"))?;
        let Ok(mut entry) = zip.by_name(&entry_name) else { continue };
        let out: PathBuf = work.join(crate::model::new_id());
        fs::create_dir_all(&out)?;
        let path = out.join(safe_name);
        std::io::copy(&mut entry, &mut fs::File::create(&path)?)?;
        drop(entry);
        match import::import_file(&lib.root.join("items"), &path, Some(&folder.id), &seen)? {
            None => skipped += 1,
            Some(new) => {
                lib.index_items(std::slice::from_ref(&new))?;
                let patch = ItemPatch {
                    name: Some(it.name.clone()),
                    rating: Some(it.rating),
                    note: Some(it.note.clone()),
                    url: Some(it.url.clone()),
                    add_tags: it.tags.clone(),
                    ..Default::default()
                };
                lib.update_items(std::slice::from_ref(&new.id), &patch)?;
                added += 1;
            }
        }
    }
    Ok((added, skipped))
}

/// Copies the original files into a folder, named after the items.
pub fn export_files(lib: &Library, ids: &[String], dest: &Path) -> Result<usize> {
    fs::create_dir_all(dest)?;
    let mut used: HashSet<String> = HashSet::new();
    let mut n = 0;
    for id in ids {
        let it = lib.get(id)?;
        let base: String = it.name.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '_' } else { c }).collect();
        let ext = if it.ext.is_empty() { String::new() } else { format!(".{}", it.ext) };
        let mut name = format!("{base}{ext}");
        let mut k = 2;
        while used.contains(&name.to_lowercase()) || dest.join(&name).exists() {
            name = format!("{base} {k}{ext}");
            k += 1;
        }
        used.insert(name.to_lowercase());
        fs::copy(lib.item_dir(id).join(&it.file_name), dest.join(&name))?;
        n += 1;
    }
    Ok(n)
}
