//! Local HTTP API used by the browser extension.
//!
//! Safety rules:
//! - listens on 127.0.0.1 only, never on the network;
//! - every request needs `Authorization: Bearer <token>`; the token is shown in
//!   Hoard and pasted into the extension once;
//! - requests sent by ordinary web pages (an `Origin` that isn't a browser
//!   extension) are refused, so a website can't add files to your library.
use crate::import;
use crate::model::{find_folder, new_id, Folder, ItemPatch};
use crate::AppState;
use anyhow::{anyhow, bail, Context, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

pub const PORT: u16 = 47821;
const MAX_BODY: u64 = 300 * 1024 * 1024;
const MAX_DOWNLOAD: u64 = 500 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfo {
    pub port: u16,
    pub token: String,
    pub running: bool,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct ApiState(pub Mutex<ApiInfo>);

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct SaveRequest {
    /// File to download (http/https).
    pub url: Option<String>,
    /// File contents as base64 or a `data:` URL (screenshots, inline images).
    pub data: Option<String>,
    pub file_name: Option<String>,
    /// Page the file was found on; stored as the item's source link.
    pub page_url: Option<String>,
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub folder_id: Option<String>,
    pub note: Option<String>,
}

fn token_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("api-token.txt"))
}

fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

pub fn regenerate_token(app: &AppHandle) -> String {
    let t = random_token();
    if let Some(f) = token_file(app) {
        let _ = fs::write(f, &t);
    }
    if let Ok(mut info) = app.state::<ApiState>().0.lock() {
        info.token = t.clone();
    }
    t
}

pub fn start(app: AppHandle) {
    let token = token_file(&app)
        .and_then(|f| fs::read_to_string(f).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() >= 32)
        .unwrap_or_else(|| regenerate_token(&app));
    if let Ok(mut info) = app.state::<ApiState>().0.lock() {
        info.port = PORT;
        info.token = token;
    }
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(s) => s,
            Err(e) => {
                if let Ok(mut info) = app.state::<ApiState>().0.lock() {
                    info.error = Some(format!("Couldn't start on port {PORT}: {e}. Is another copy of Hoard running?"));
                }
                return;
            }
        };
        if let Ok(mut info) = app.state::<ApiState>().0.lock() {
            info.running = true;
        }
        for req in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle(&app, req));
        }
    });
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers().iter().find(|h| h.field.to_string().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn is_extension_origin(o: &str) -> bool {
    ["chrome-extension://", "moz-extension://", "safari-web-extension://"].iter().any(|p| o.starts_with(p))
}

fn reply(req: Request, code: u16, body: Value, origin: Option<&str>) {
    let mut res = Response::from_string(if body.is_null() { String::new() } else { body.to_string() })
        .with_status_code(code)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    if let Some(o) = origin.filter(|o| is_extension_origin(o)) {
        for (k, v) in [
            ("Access-Control-Allow-Origin", o),
            ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
            ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ] {
            res = res.with_header(Header::from_bytes(k, v).unwrap());
        }
    }
    let _ = req.respond(res);
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn handle(app: &AppHandle, mut req: Request) {
    let origin = header(&req, "Origin");
    if let Some(o) = &origin {
        if !is_extension_origin(o) {
            return reply(req, 403, json!({"error": "Requests from web pages are not allowed"}), None);
        }
    }
    let o = origin.as_deref();
    if req.method() == &Method::Options {
        return reply(req, 204, Value::Null, o);
    }
    let token = app.state::<ApiState>().0.lock().map(|i| i.token.clone()).unwrap_or_default();
    let given = header(&req, "Authorization").and_then(|h| h.strip_prefix("Bearer ").map(str::to_string)).unwrap_or_default();
    if token.is_empty() || !same(&given, &token) {
        return reply(req, 401, json!({"error": "Wrong or missing token. Copy it from Hoard → library menu → Browser extension."}), o);
    }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    let result = match (req.method().clone(), path.as_str()) {
        (Method::Get, "/v1/status") => status(app),
        (Method::Post, "/v1/items") => {
            let mut body = String::new();
            match req.as_reader().take(MAX_BODY).read_to_string(&mut body) {
                Ok(_) => serde_json::from_str::<SaveRequest>(&body).map_err(|e| anyhow!("Bad request: {e}")).and_then(|r| save(app, r)),
                Err(e) => Err(anyhow!("Couldn't read the request: {e}")),
            }
        }
        _ => return reply(req, 404, json!({"error": "Not found"}), o),
    };
    match result {
        Ok(v) => reply(req, 200, v, o),
        Err(e) => reply(req, 400, json!({"error": e.to_string()}), o),
    }
}

fn flat_folders(list: &[Folder], depth: usize, out: &mut Vec<Value>) {
    for f in list {
        out.push(json!({"id": f.id, "name": f.name, "depth": depth}));
        flat_folders(&f.children, depth + 1, out);
    }
}

fn status(app: &AppHandle) -> Result<Value> {
    let st = app.state::<AppState>();
    let g = st.lib.lock().map_err(|_| anyhow!("busy"))?;
    let Some(lib) = g.as_ref() else {
        return Ok(json!({"app": "hoard", "version": env!("CARGO_PKG_VERSION"), "library": null, "folders": []}));
    };
    let mut folders = vec![];
    flat_folders(&lib.meta.folders, 0, &mut folders);
    Ok(json!({"app": "hoard", "version": env!("CARGO_PKG_VERSION"), "library": lib.meta.name, "folders": folders}))
}

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    Some(match mime.split(';').next()?.trim() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/heic" => "heic",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "application/pdf" => "pdf",
        _ => return None,
    })
}

/// A safe file name: from the hint or the URL, with an extension from the MIME type when missing.
fn file_name(hint: Option<&str>, url: Option<&str>, mime: Option<&str>) -> String {
    let from_url = url.and_then(|u| {
        let path = u.split(['?', '#']).next()?;
        let last = path.rsplit('/').next()?;
        (!last.is_empty()).then(|| percent_decode(last))
    });
    let base = hint.map(str::to_string).filter(|s| !s.trim().is_empty()).or(from_url).unwrap_or_else(|| "image".into());
    let mut name: String = base.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '_' } else { c }).collect();
    name = name.trim().trim_start_matches('.').chars().take(120).collect();
    if name.is_empty() {
        name = "image".into();
    }
    let has_ext = Path::new(&name).extension().map(|e| e.len() <= 5).unwrap_or(false);
    if !has_ext {
        if let Some(ext) = mime.and_then(ext_for_mime) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Downloads or decodes the file into `dir` and returns its path.
fn fetch_to(dir: &Path, r: &SaveRequest) -> Result<PathBuf> {
    if let Some(data) = r.data.as_deref().filter(|d| !d.is_empty()) {
        let (mime, b64) = match data.strip_prefix("data:") {
            Some(rest) => {
                let (meta, payload) = rest.split_once(',').ok_or_else(|| anyhow!("Bad data URL"))?;
                if !meta.ends_with(";base64") {
                    bail!("Only base64 data URLs are supported");
                }
                (Some(meta.trim_end_matches(";base64").to_string()), payload)
            }
            None => (None, data),
        };
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).context("Bad base64 data")?;
        let p = dir.join(file_name(r.file_name.as_deref(), None, mime.as_deref().or(Some("image/png"))));
        fs::write(&p, bytes)?;
        return Ok(p);
    }
    let url = r.url.as_deref().ok_or_else(|| anyhow!("Send either url or data"))?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        bail!("Only http and https links can be downloaded");
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .user_agent("Mozilla/5.0 (Macintosh) Hoard/0.1")
        .build();
    let mut call = agent.get(url);
    // Many sites only serve images when they come "from" their own pages.
    if let Some(page) = r.page_url.as_deref().filter(|p| p.starts_with("http")) {
        call = call.set("Referer", page);
    }
    let res = call.call().map_err(|e| anyhow!("Download failed: {e}"))?;
    let mime = res.header("Content-Type").map(str::to_string);
    if mime.as_deref().map(|m| m.starts_with("text/html")).unwrap_or(false) {
        bail!("That link is a web page, not a file");
    }
    let p = dir.join(file_name(r.file_name.as_deref(), Some(res.get_url()), mime.as_deref()));
    let mut f = fs::File::create(&p)?;
    let n = std::io::copy(&mut res.into_reader().take(MAX_DOWNLOAD + 1), &mut f)?;
    if n > MAX_DOWNLOAD {
        bail!("File is larger than 500 MB");
    }
    if n == 0 {
        bail!("The download was empty");
    }
    Ok(p)
}

fn save(app: &AppHandle, r: SaveRequest) -> Result<Value> {
    let (root, known, folder) = {
        let st = app.state::<AppState>();
        let mut g = st.lib.lock().map_err(|_| anyhow!("busy"))?;
        let lib = g.as_mut().ok_or_else(|| anyhow!("Open a library in Hoard first"))?;
        let folder = r.folder_id.clone().filter(|f| find_folder(&lib.meta.folders, f).is_some());
        (lib.root.clone(), lib.file_hashes()?, folder)
    };
    let tmp = app.path().app_cache_dir()?.join("incoming").join(new_id());
    fs::create_dir_all(&tmp)?;
    let result = (|| -> Result<Value> {
        let file = fetch_to(&tmp, &r)?;
        let seen = Mutex::new(known);
        let Some(item) = import::import_file(&root.join("items"), &file, folder.as_deref(), &seen)? else {
            return Ok(json!({"status": "duplicate"}));
        };
        let st = app.state::<AppState>();
        let mut g = st.lib.lock().map_err(|_| anyhow!("busy"))?;
        let lib = g.as_mut().filter(|l| l.root == root).ok_or_else(|| anyhow!("The library was closed"))?;
        lib.index_items(std::slice::from_ref(&item))?;
        let patch = ItemPatch {
            name: r.title.clone().map(|t| t.trim().chars().take(200).collect()),
            url: r.page_url.clone().or(r.url.clone()),
            note: r.note.clone().filter(|n| !n.trim().is_empty()),
            add_tags: r.tags.clone(),
            ..Default::default()
        };
        lib.update_items(std::slice::from_ref(&item.id), &patch)?;
        let _ = app.emit("items-imported", 1);
        Ok(json!({"status": "saved", "id": item.id}))
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(file_name(None, Some("https://x.com/a/b/photo%20one.jpg?w=200"), Some("image/jpeg")), "photo one.jpg");
        assert_eq!(file_name(None, Some("https://x.com/img/abc"), Some("image/webp")), "abc.webp");
        assert_eq!(file_name(Some("../../etc/passwd"), None, None), "_.._etc_passwd");
        assert_eq!(file_name(None, Some("https://x.com/"), Some("image/png")), "image.png");
        assert!(is_extension_origin("chrome-extension://abc"));
        assert!(!is_extension_origin("https://evil.example"));
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
