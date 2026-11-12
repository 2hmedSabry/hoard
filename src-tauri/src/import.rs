//! Copying files into the library and making thumbnails, dimensions and palettes.
use crate::hashing;
use crate::model::{new_id, now_ms, Item};
use std::collections::HashSet;
use std::sync::Mutex;
use crate::palette;
use anyhow::{anyhow, Result};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageDecoder, ImageReader};
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const THUMB: u32 = 480;

pub fn kind_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" | "heif" | "avif" | "svg"
        | "psd" | "ico" | "icns" | "tga" | "jxl" | "exr" | "hdr" | "raw" | "cr2" | "cr3" | "nef" | "arw"
        | "dng" | "orf" | "rw2" | "raf" => "image",
        "mp4" | "mov" | "m4v" | "webm" | "mkv" | "avi" | "wmv" | "flv" | "mpg" | "mpeg" | "3gp" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "aif" | "aiff" | "opus" | "wma" => "audio",
        "ttf" | "otf" | "woff" | "woff2" | "ttc" => "font",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "key" | "pages" | "numbers" | "txt" | "md"
        | "rtf" | "csv" | "json" | "html" | "htm" | "ai" | "eps" | "sketch" | "fig" | "xd" | "epub" => "document",
        _ => "other",
    }
}

fn is_hidden(p: &Path) -> bool {
    p.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false)
}

/// Expand dropped paths: folders are walked, hidden files and Hoard libraries skipped.
pub fn collect_files(paths: &[String]) -> Vec<PathBuf> {
    let mut out = vec![];
    for p in paths {
        let p = PathBuf::from(p);
        if p.is_dir() {
            if p.extension().map(|e| e == "hoard").unwrap_or(false) {
                continue;
            }
            let walker = walkdir::WalkDir::new(&p).follow_links(false).into_iter().filter_entry(|e| {
                !(e.depth() > 0 && is_hidden(e.path()))
                    && !e.path().extension().map(|x| x == "hoard").unwrap_or(false)
            });
            for e in walker.flatten() {
                if e.file_type().is_file() {
                    out.push(e.into_path());
                }
            }
        } else if p.is_file() && !is_hidden(&p) {
            out.push(p);
        }
    }
    out
}

fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '_' } else { c })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() || s == "." || s == ".." {
        "file".into()
    } else {
        s
    }
}

/// Imports one file. Returns `Ok(None)` when an exact copy is already in the
/// library (or earlier in this import), using `seen` as the set of file hashes.
pub fn import_file(items_dir: &Path, src: &Path, folder: Option<&str>, seen: &Mutex<HashSet<String>>) -> Result<Option<Item>> {
    let fhash = hashing::file_hash(src)?;
    if !seen.lock().map_err(|_| anyhow!("lock poisoned"))?.insert(fhash.clone()) {
        return Ok(None);
    }
    let id = new_id();
    let dir = items_dir.join(&id);
    fs::create_dir_all(&dir)?;
    let res = (|| -> Result<Item> {
        let orig = src.file_name().ok_or_else(|| anyhow!("no file name"))?.to_string_lossy().to_string();
        let file_name = safe_name(&orig);
        let dst = dir.join(&file_name);
        fs::copy(src, &dst)?;
        let ext = dst.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        let name = Path::new(&file_name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or(file_name.clone());
        let now = now_ms();
        let mut item = Item {
            id: id.clone(),
            name,
            kind: kind_for(&ext).into(),
            ext,
            file_name,
            size: fs::metadata(&dst)?.len(),
            width: 0,
            height: 0,
            tags: vec![],
            folders: folder.map(|f| vec![f.to_string()]).unwrap_or_default(),
            rating: 0,
            note: String::new(),
            url: String::new(),
            palette: vec![],
            created_at: now,
            modified_at: now,
            deleted: false,
            thumb: None,
            duration: None,
            fhash: Some(fhash.clone()),
            dhash: None,
        };
        if let Some(img) = make_thumb(&dst, &dir, &mut item) {
            item.palette = palette::extract(&img);
            item.dhash = Some(hashing::dhash(&img));
        }
        crate::library::write_json(&dir.join("item.json"), &item)?;
        Ok(item)
    })();
    if res.is_err() {
        let _ = fs::remove_dir_all(&dir);
        // Let a later retry of the same file through.
        if let Ok(mut s) = seen.lock() {
            s.remove(&fhash);
        }
    }
    res.map(Some)
}

/// Writes `thumb.jpg` (or `thumb.png` when transparent) and fills in size info.
fn make_thumb(file: &Path, dir: &Path, item: &mut Item) -> Option<DynamicImage> {
    let mut img: Option<DynamicImage> = None;
    match item.kind.as_str() {
        "image" => match decode_oriented(file) {
            Some(i) => {
                item.width = i.width();
                item.height = i.height();
                img = Some(i);
            }
            None => {
                if let Some((w, h)) = if item.ext == "svg" { svg_size(file) } else { sips_size(file) } {
                    item.width = w;
                    item.height = h;
                }
            }
        },
        "video" | "audio" => {
            probe(file, item);
            if item.kind == "video" {
                img = video_frame(file, dir, item.duration.unwrap_or(0.0));
            }
        }
        _ => {}
    }
    if img.is_none() {
        img = quicklook(file, dir);
        if let Some(i) = &img {
            if item.width == 0 && item.kind == "image" && item.ext != "svg" {
                item.width = i.width();
                item.height = i.height();
            }
        }
    }
    let t = img?.thumbnail(THUMB, THUMB);
    let saved = if t.color().has_alpha() {
        t.save_with_format(dir.join("thumb.png"), image::ImageFormat::Png).ok().map(|_| "thumb.png")
    } else {
        fs::File::create(dir.join("thumb.jpg"))
            .ok()
            .and_then(|f| JpegEncoder::new_with_quality(BufWriter::new(f), 84).encode_image(&t.to_rgb8()).ok())
            .map(|_| "thumb.jpg")
    };
    item.thumb = saved.map(String::from);
    Some(t)
}

fn decode_oriented(file: &Path) -> Option<DynamicImage> {
    let mut dec = ImageReader::open(file).ok()?.with_guessed_format().ok()?.into_decoder().ok()?;
    let orientation = dec.orientation().ok();
    let mut img = DynamicImage::from_decoder(dec).ok()?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Some(img)
}

/// Finds a command-line tool even when the app is started from Finder (no shell PATH).
fn tool(name: &str) -> Option<PathBuf> {
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let p = Path::new(dir).join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Reads width/height (or the viewBox) from the root <svg> tag.
fn svg_size(file: &Path) -> Option<(u32, u32)> {
    let text = fs::read_to_string(file).ok()?;
    let start = text.find("<svg")?;
    let tag = &text[start..start + text[start..].find('>')?];
    let attr = |name: &str| -> Option<String> {
        let i = tag.find(&format!(" {name}="))? + name.len() + 2;
        let q = tag[i..].chars().next()?;
        let rest = &tag[i + 1..];
        Some(rest[..rest.find(q)?].to_string())
    };
    let num = |s: String| s.trim_end_matches("px").trim().parse::<f32>().ok();
    if let (Some(w), Some(h)) = (attr("width").and_then(num), attr("height").and_then(num)) {
        return Some((w.round() as u32, h.round() as u32));
    }
    let vb: Vec<f32> = attr("viewBox")?.split(|c: char| c == ' ' || c == ',').filter_map(|x| x.parse().ok()).collect();
    (vb.len() == 4).then(|| (vb[2].round() as u32, vb[3].round() as u32))
}

fn sips_size(file: &Path) -> Option<(u32, u32)> {
    let out = Command::new("/usr/bin/sips").args(["-g", "pixelWidth", "-g", "pixelHeight"]).arg(file).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let get = |key: &str| {
        text.lines().find_map(|l| l.trim().strip_prefix(key).and_then(|v| v.trim().parse::<u32>().ok()))
    };
    Some((get("pixelWidth:")?, get("pixelHeight:")?))
}

fn probe(file: &Path, item: &mut Item) {
    let Some(ffprobe) = tool("ffprobe") else { return };
    let Ok(out) = Command::new(ffprobe)
        .args(["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json"])
        .arg(file)
        .output()
    else {
        return;
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else { return };
    if let Some(d) = v["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()) {
        item.duration = Some(d);
    }
    if let Some(s) = v["streams"].as_array().and_then(|a| a.iter().find(|s| s["codec_type"] == "video")) {
        item.width = s["width"].as_u64().unwrap_or(0) as u32;
        item.height = s["height"].as_u64().unwrap_or(0) as u32;
    }
}

fn video_frame(file: &Path, dir: &Path, duration: f64) -> Option<DynamicImage> {
    let ffmpeg = tool("ffmpeg")?;
    let tmp = dir.join(".frame.jpg");
    let at = if duration > 3.0 { duration * 0.1 } else { 0.0 };
    let ok = Command::new(ffmpeg)
        .args(["-v", "error", "-y", "-ss", &format!("{at:.2}"), "-i"])
        .arg(file)
        .args(["-frames:v", "1", "-vf", "scale=960:-2"])
        .arg(&tmp)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let img = if ok { image::open(&tmp).ok() } else { None };
    let _ = fs::remove_file(&tmp);
    img
}

/// macOS Quick Look renders PDFs, PSD, HEIC, SVG, Office files, fonts and more.
fn quicklook(file: &Path, dir: &Path) -> Option<DynamicImage> {
    let tmp = dir.join(".ql");
    fs::create_dir_all(&tmp).ok()?;
    let _ = Command::new("/usr/bin/qlmanage")
        .args(["-t", "-s", "960", "-o"])
        .arg(&tmp)
        .arg(file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let out = fs::read_dir(&tmp).ok()?.flatten().map(|e| e.path()).find(|p| p.extension().map(|e| e == "png").unwrap_or(false));
    let img = out.and_then(|p| image::open(p).ok());
    let _ = fs::remove_dir_all(&tmp);
    img
}
