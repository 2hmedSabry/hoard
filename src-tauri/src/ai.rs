//! On-device analysis with Apple's Vision framework, through the small Swift
//! helper in `vision/main.swift`. Runs in the background after import:
//! suggested labels, text found in images (OCR) and a feature print used for
//! "Find similar". Nothing leaves the computer.
use crate::library::Library;
use crate::model::Item;
use crate::AppState;
use anyhow::{anyhow, Result};
use base64::Engine;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hoard-vision"));
#[cfg(not(target_os = "macos"))]
const HELPER: &[u8] = b"";

const BATCH: usize = 12;
const FEATURE_FILE: &str = "vision.bin";

#[derive(Deserialize)]
struct Label {
    id: String,
    confidence: f32,
}

#[derive(Deserialize)]
struct Output {
    path: String,
    #[serde(default)]
    labels: Vec<Label>,
    #[serde(default)]
    text: String,
    feature: Option<String>,
}

fn helper_path(app: &AppHandle) -> Result<PathBuf> {
    if HELPER.is_empty() {
        return Err(anyhow!("On-device analysis isn't available on this system"));
    }
    let dir = app.path().app_cache_dir()?;
    fs::create_dir_all(&dir)?;
    let p = dir.join("hoard-vision");
    if fs::metadata(&p).map(|m| m.len() != HELPER.len() as u64).unwrap_or(true) {
        let tmp = dir.join("hoard-vision.tmp");
        fs::write(&tmp, HELPER)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
        }
        fs::rename(&tmp, &p)?;
    }
    Ok(p)
}

/// Picture to analyse: the original for images Vision can read, otherwise the thumbnail.
fn source(lib: &Library, it: &Item) -> Option<PathBuf> {
    // Plain-text files have their own viewer; their thumbnails only confuse the labeller.
    if matches!(it.ext.as_str(), "txt" | "md" | "csv" | "json" | "log" | "xml" | "yml" | "yaml" | "rtf") {
        return None;
    }
    let dir = lib.item_dir(&it.id);
    let original_ok = it.kind == "image" && !matches!(it.ext.as_str(), "svg" | "ico" | "exr" | "hdr") && it.size < 60 * 1024 * 1024;
    if original_ok {
        return Some(dir.join(&it.file_name));
    }
    it.thumb.as_ref().map(|t| dir.join(t))
}

pub fn label_text(id: &str) -> String {
    id.replace('_', " ")
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        let mut worked = run_batch(&app).unwrap_or(false);
        if !worked {
            // Quiet moment: fill in camera details for items imported before they existed.
            let st = app.state::<AppState>();
            let filled = match st.lib.lock() {
                Ok(mut g) => g.as_mut().map(|lib| lib.backfill_exif(50).map(|n| n > 0).unwrap_or(false)).unwrap_or(false),
                Err(_) => false,
            };
            worked = filled;
        }
        std::thread::sleep(if worked { Duration::from_millis(300) } else { Duration::from_secs(4) });
    });
}

fn run_batch(app: &AppHandle) -> Result<bool> {
    let (root, jobs) = {
        let st = app.state::<AppState>();
        let g = st.lib.lock().map_err(|_| anyhow!("busy"))?;
        let Some(lib) = g.as_ref() else { return Ok(false) };
        let ids = lib.pending_analysis(BATCH)?;
        let jobs: Vec<(String, Option<PathBuf>)> = ids
            .into_iter()
            .filter_map(|id| lib.get(&id).ok())
            .map(|it| (it.id.clone(), source(lib, &it)))
            .collect();
        (lib.root.clone(), jobs)
    };
    if jobs.is_empty() {
        return Ok(false);
    }
    let paths: Vec<&PathBuf> = jobs.iter().filter_map(|(_, p)| p.as_ref()).collect();
    let mut outputs = std::collections::HashMap::new();
    if !paths.is_empty() {
        let helper = helper_path(app)?;
        let out = Command::new(helper).args(&paths).output()?;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Ok(o) = serde_json::from_str::<Output>(line) {
                outputs.insert(PathBuf::from(&o.path), o);
            }
        }
    }
    let st = app.state::<AppState>();
    let mut g = st.lib.lock().map_err(|_| anyhow!("busy"))?;
    let Some(lib) = g.as_mut().filter(|l| l.root == root) else { return Ok(false) };
    let mut changed = vec![];
    for (id, path) in jobs {
        let Ok(mut it) = lib.get(&id) else { continue };
        if let Some(o) = path.as_ref().and_then(|p| outputs.remove(p)) {
            it.labels = o.labels.iter().filter(|l| l.confidence >= 0.3).take(8).map(|l| label_text(&l.id)).collect();
            it.ocr = o.text.trim().chars().take(20_000).collect();
            if let Some(f) = o.feature.and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok()) {
                let _ = fs::write(lib.item_dir(&id).join(FEATURE_FILE), f);
            }
        }
        // Marked done even when Vision couldn't read it, so it isn't retried forever.
        it.analyzed = true;
        changed.push(it);
    }
    lib.save_analysis(&changed)?;
    let remaining = lib.pending_analysis(10_000).map(|v| v.len()).unwrap_or(0);
    let _ = app.emit("items-analyzed", remaining);
    Ok(true)
}

fn read_feature(lib: &Library, id: &str) -> Option<Vec<f32>> {
    let b = fs::read(lib.item_dir(id).join(FEATURE_FILE)).ok()?;
    Some(b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

/// Items that look most like `id`, closest first.
pub fn similar(lib: &Library, id: &str, limit: usize) -> Result<Vec<Item>> {
    let target = read_feature(lib, id).ok_or_else(|| anyhow!("This item hasn't been analysed yet. Try again in a moment."))?;
    let mut scored: Vec<(f32, Item)> = lib
        .all_items(false)?
        .into_iter()
        .filter(|it| it.id != id)
        .filter_map(|it| {
            let f = read_feature(lib, &it.id)?;
            (f.len() == target.len()).then(|| {
                let d: f32 = f.iter().zip(&target).map(|(a, b)| (a - b) * (a - b)).sum::<f32>().sqrt();
                (d, it)
            })
        })
        .collect();
    scored.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(scored.into_iter().take(limit).map(|(_, it)| it).collect())
}
