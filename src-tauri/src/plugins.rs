//! Plugins: folders in `<app data>/plugins/<id>/` with a `plugin.json` and a
//! single HTML file. The HTML runs in a sandboxed iframe (scripts only, no
//! same-origin access) and talks to Hoard through postMessage; see
//! `src/components/PluginHost.tsx` for the API it gets.
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    /// HTML file to run, relative to the plugin folder.
    #[serde(default = "default_main")]
    pub main: String,
    /// "read" (selection and search) and/or "write" (change item details).
    #[serde(default)]
    pub permissions: Vec<String>,
}

fn default_main() -> String {
    "index.html".into()
}

const MAX_HTML: u64 = 5 * 1024 * 1024;

pub fn dir(app: &AppHandle) -> Result<PathBuf> {
    let d = app.path().app_data_dir()?.join("plugins");
    fs::create_dir_all(&d)?;
    Ok(d)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') && !id.starts_with('.')
}

fn read_manifest(folder: &Path) -> Result<PluginInfo> {
    let text = fs::read_to_string(folder.join("plugin.json")).context("plugin.json is missing")?;
    let p: PluginInfo = serde_json::from_str(&text).context("plugin.json is not valid")?;
    if !valid_id(&p.id) {
        bail!("Plugin id may only use letters, numbers, '-', '_' and '.'");
    }
    if p.name.trim().is_empty() {
        bail!("Plugin needs a name");
    }
    if p.main.contains("..") || p.main.starts_with('/') {
        bail!("Plugin main file must be inside its folder");
    }
    Ok(p)
}

pub fn list(app: &AppHandle) -> Result<Vec<PluginInfo>> {
    let mut out = vec![];
    for e in fs::read_dir(dir(app)?)?.flatten() {
        if e.path().is_dir() {
            if let Ok(p) = read_manifest(&e.path()) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn html(app: &AppHandle, id: &str) -> Result<String> {
    if !valid_id(id) {
        bail!("Bad plugin id");
    }
    let folder = dir(app)?.join(id);
    let p = read_manifest(&folder)?;
    let file = folder.join(&p.main);
    if fs::metadata(&file)?.len() > MAX_HTML {
        bail!("Plugin page is larger than 5 MB");
    }
    Ok(fs::read_to_string(file)?)
}

/// Copies a plugin folder (one that contains plugin.json) into the plugins folder.
pub fn install(app: &AppHandle, src: &Path) -> Result<PluginInfo> {
    let p = read_manifest(src)?;
    if !src.join(&p.main).is_file() {
        bail!("{} is missing", p.main);
    }
    let dest = dir(app)?.join(&p.id);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    copy_dir(src, &dest)?;
    Ok(p)
}

fn copy_dir(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    for e in fs::read_dir(src)?.flatten() {
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let ft = e.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            copy_dir(&e.path(), &dest.join(&name))?;
        } else {
            fs::copy(e.path(), dest.join(&name))?;
        }
    }
    Ok(())
}

pub fn remove(app: &AppHandle, id: &str) -> Result<()> {
    if !valid_id(id) {
        return Err(anyhow!("Bad plugin id"));
    }
    let d = dir(app)?.join(id);
    if d.exists() {
        fs::remove_dir_all(d)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifests() {
        assert!(valid_id("tag-tidy") && valid_id("a.b_c") && !valid_id("../x") && !valid_id(".hidden") && !valid_id(""));
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins");
        for p in ["palette-export", "tag-tidy"] {
            let m = read_manifest(&root.join(p)).unwrap();
            assert_eq!(m.id, p);
            assert!(root.join(p).join(&m.main).is_file());
        }
        let tmp = std::env::temp_dir().join(format!("hoard-plugin-{}", crate::model::new_id()));
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("plugin.json"), r#"{"id":"x","name":"X","main":"../../etc/passwd"}"#).unwrap();
        assert!(read_manifest(&tmp).is_err(), "main outside the folder is refused");
        fs::remove_dir_all(&tmp).unwrap();
    }
}
