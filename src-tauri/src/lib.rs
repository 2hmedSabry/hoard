mod api_server;
mod hashing;
mod import;
mod library;
mod model;
mod pack;
mod palette;
mod rules;
mod watch;

use library::Library;
use model::*;
use rayon::prelude::*;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct AppState {
    lib: Mutex<Option<Library>>,
}

type R<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn with_lib<T>(st: &AppState, f: impl FnOnce(&mut Library) -> anyhow::Result<T>) -> R<T> {
    let mut g = st.lib.lock().map_err(err)?;
    let lib = g.as_mut().ok_or_else(|| "No library is open".to_string())?;
    f(lib).map_err(err)
}

fn last_library_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("last-library.txt"))
}

fn set_library(app: &AppHandle, st: &AppState, lib: Library) -> R<LibraryInfo> {
    if let Some(f) = last_library_file(app) {
        let _ = fs::write(f, lib.root.to_string_lossy().as_bytes());
    }
    let info = lib.info();
    *st.lib.lock().map_err(err)? = Some(lib);
    Ok(info)
}

#[tauri::command]
fn open_last_library(app: AppHandle, st: State<AppState>) -> R<Option<LibraryInfo>> {
    let Some(path) = last_library_file(&app).and_then(|f| fs::read_to_string(f).ok()) else {
        return Ok(None);
    };
    match Library::open(&PathBuf::from(path.trim())) {
        Ok(lib) => set_library(&app, &st, lib).map(Some),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn create_library(app: AppHandle, st: State<AppState>, parent: String, name: String) -> R<LibraryInfo> {
    let lib = Library::create(&PathBuf::from(parent), &name).map_err(err)?;
    set_library(&app, &st, lib)
}

#[tauri::command]
fn open_library(app: AppHandle, st: State<AppState>, path: String) -> R<LibraryInfo> {
    let mut p = PathBuf::from(path);
    if p.file_name().map(|n| n == "library.json").unwrap_or(false) {
        p.pop();
    }
    let lib = Library::open(&p).map_err(err)?;
    set_library(&app, &st, lib)
}

#[tauri::command]
fn library_info(st: State<AppState>) -> R<LibraryInfo> {
    with_lib(&st, |l| Ok(l.info()))
}

#[tauri::command]
fn query_items(st: State<AppState>, query: Query) -> R<Vec<Item>> {
    with_lib(&st, |l| l.query(&query))
}

#[tauri::command]
fn library_stats(st: State<AppState>) -> R<Stats> {
    with_lib(&st, |l| l.stats())
}

#[tauri::command]
fn update_items(st: State<AppState>, ids: Vec<String>, patch: ItemPatch) -> R<Vec<Item>> {
    with_lib(&st, |l| l.update_items(&ids, &patch))
}

#[tauri::command]
fn set_trashed(st: State<AppState>, ids: Vec<String>, trashed: bool) -> R<()> {
    with_lib(&st, |l| l.set_trashed(&ids, trashed))
}

#[tauri::command]
fn empty_trash(st: State<AppState>) -> R<usize> {
    with_lib(&st, |l| l.empty_trash())
}

#[tauri::command]
fn create_folder(st: State<AppState>, name: String, parent_id: Option<String>) -> R<Folder> {
    with_lib(&st, |l| l.create_folder(&name, parent_id.as_deref()))
}

#[tauri::command]
fn rename_folder(st: State<AppState>, id: String, name: String) -> R<()> {
    with_lib(&st, |l| l.rename_folder(&id, &name))
}

#[tauri::command]
fn move_folder(st: State<AppState>, id: String, parent_id: Option<String>) -> R<()> {
    with_lib(&st, |l| l.move_folder(&id, parent_id.as_deref()))
}

#[tauri::command]
fn delete_folder(st: State<AppState>, id: String) -> R<()> {
    with_lib(&st, |l| l.delete_folder(&id))
}

#[tauri::command]
fn create_smart_folder(st: State<AppState>, name: String, match_mode: String, rules: Vec<Rule>) -> R<SmartFolder> {
    with_lib(&st, |l| l.create_smart_folder(&name, &match_mode, rules))
}

#[tauri::command]
fn update_smart_folder(st: State<AppState>, id: String, name: String, match_mode: String, rules: Vec<Rule>) -> R<()> {
    with_lib(&st, |l| l.update_smart_folder(&id, &name, &match_mode, rules))
}

#[tauri::command]
fn delete_smart_folder(st: State<AppState>, id: String) -> R<()> {
    with_lib(&st, |l| l.delete_smart_folder(&id))
}

/// Can take a few seconds on a big library the first time (fingerprints are
/// filled in for older items), so it runs off the main thread.
#[tauri::command]
async fn find_duplicates(app: AppHandle, max_distance: u32) -> R<Vec<DupGroup>> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<AppState>();
        with_lib(&st, |l| l.duplicates(max_distance.min(16)))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn rename_tag(st: State<AppState>, from: String, to: String) -> R<()> {
    with_lib(&st, |l| l.rename_tag(&from, &to))
}

#[tauri::command]
fn rebuild_index(st: State<AppState>) -> R<usize> {
    with_lib(&st, |l| l.rebuild_index())
}

#[tauri::command]
fn reveal_item(st: State<AppState>, id: String) -> R<()> {
    let p = with_lib(&st, |l| l.file_path(&id))?;
    std::process::Command::new("/usr/bin/open").arg("-R").arg(p).spawn().map_err(err)?;
    Ok(())
}

#[tauri::command]
fn open_item(st: State<AppState>, id: String) -> R<()> {
    let p = with_lib(&st, |l| l.file_path(&id))?;
    std::process::Command::new("/usr/bin/open").arg(p).spawn().map_err(err)?;
    Ok(())
}

#[tauri::command]
fn api_info(st: State<api_server::ApiState>) -> R<api_server::ApiInfo> {
    st.0.lock().map(|i| i.clone()).map_err(err)
}

#[tauri::command]
fn regenerate_api_token(app: AppHandle) -> R<String> {
    Ok(api_server::regenerate_token(&app))
}

#[tauri::command]
fn open_url(url: String) -> R<()> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only web links can be opened".into());
    }
    std::process::Command::new("/usr/bin/open").arg(url).spawn().map_err(err)?;
    Ok(())
}

/// Imports files in batches so the grid fills in as it goes. Used by the
/// Import button, drag and drop, and watched folders.
pub(crate) fn import_files(app: &AppHandle, files: Vec<PathBuf>, folder_id: Option<String>, show_progress: bool) -> R<usize> {
    let (root, known) = {
        let st = app.state::<AppState>();
        let mut g = st.lib.lock().map_err(err)?;
        let lib = g.as_mut().ok_or_else(|| "No library is open".to_string())?;
        (lib.root.clone(), lib.file_hashes().map_err(err)?)
    };
    let seen = std::sync::Mutex::new(known);
    let skipped = AtomicUsize::new(0);
    let total = files.len();
    let items_dir = root.join("items");
    let done = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(4).build().map_err(err)?;
    let progress = |d: usize| {
        if show_progress {
            let _ = app.emit(
                "import-progress",
                ImportProgress { done: d, total, failed: failed.load(Ordering::SeqCst), skipped: skipped.load(Ordering::SeqCst) },
            );
        }
    };
    progress(0);
    let mut imported = 0;
    for chunk in files.chunks(24) {
        let items: Vec<Item> = pool.install(|| {
            chunk
                .par_iter()
                .filter_map(|f| {
                    let r = import::import_file(&items_dir, f, folder_id.as_deref(), &seen);
                    match &r {
                        Err(_) => {
                            failed.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(None) => {
                            skipped.fetch_add(1, Ordering::SeqCst);
                        }
                        Ok(Some(_)) => {}
                    }
                    progress(done.fetch_add(1, Ordering::SeqCst) + 1);
                    r.ok().flatten()
                })
                .collect()
        });
        {
            let st = app.state::<AppState>();
            let mut g = st.lib.lock().map_err(err)?;
            match g.as_mut() {
                Some(lib) if lib.root == root => lib.index_items(&items).map_err(err)?,
                _ => return Err("The library was closed during import".into()),
            }
        }
        imported += items.len();
        if !items.is_empty() {
            let _ = app.emit("items-imported", imported);
        }
    }
    Ok(imported)
}

#[tauri::command]
async fn import_paths(app: AppHandle, paths: Vec<String>, folder_id: Option<String>) -> R<usize> {
    tauri::async_runtime::spawn_blocking(move || import_files(&app, import::collect_files(&paths), folder_id, true))
        .await
        .map_err(err)?
}

#[tauri::command]
fn set_annotations(st: State<AppState>, id: String, annotations: Vec<Annotation>) -> R<Item> {
    with_lib(&st, |l| l.set_annotations(&id, annotations))
}

#[tauri::command]
fn rename_items(st: State<AppState>, names: Vec<(String, String)>) -> R<()> {
    with_lib(&st, |l| l.rename_many(&names))
}

#[tauri::command]
async fn transform_items(app: AppHandle, ids: Vec<String>, op: String) -> R<Vec<Item>> {
    tauri::async_runtime::spawn_blocking(move || with_lib(&app.state::<AppState>(), |l| l.transform(&ids, &op)))
        .await
        .map_err(err)?
}

#[tauri::command]
async fn export_pack(app: AppHandle, ids: Vec<String>, dest: String) -> R<usize> {
    tauri::async_runtime::spawn_blocking(move || with_lib(&app.state::<AppState>(), |l| pack::export(l, &ids, &PathBuf::from(&dest))))
        .await
        .map_err(err)?
}

#[tauri::command]
async fn export_files(app: AppHandle, ids: Vec<String>, dest: String) -> R<usize> {
    tauri::async_runtime::spawn_blocking(move || with_lib(&app.state::<AppState>(), |l| pack::export_files(l, &ids, &PathBuf::from(&dest))))
        .await
        .map_err(err)?
}

/// Returns (added, skipped as duplicates).
#[tauri::command]
async fn import_pack(app: AppHandle, path: String) -> R<(usize, usize)> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = app.path().app_cache_dir().map_err(err)?.join("pack").join(new_id());
        let r = with_lib(&app.state::<AppState>(), |l| pack::import(l, &PathBuf::from(&path), &work));
        let _ = fs::remove_dir_all(&work);
        if r.is_ok() {
            let _ = app.emit("items-imported", 0);
        }
        r
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn add_watched_folder(st: State<AppState>, path: String, folder_id: Option<String>) -> R<()> {
    with_lib(&st, |l| l.add_watched(&path, folder_id))
}

#[tauri::command]
fn update_watched_folder(st: State<AppState>, id: String, enabled: bool, folder_id: Option<String>) -> R<()> {
    with_lib(&st, |l| l.update_watched(&id, enabled, folder_id))
}

#[tauri::command]
fn remove_watched_folder(st: State<AppState>, id: String) -> R<()> {
    with_lib(&st, |l| l.remove_watched(&id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(api_server::ApiState::default())
        .setup(|app| {
            api_server::start(app.handle().clone());
            watch::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_last_library,
            create_library,
            open_library,
            library_info,
            query_items,
            library_stats,
            update_items,
            set_trashed,
            empty_trash,
            create_folder,
            rename_folder,
            move_folder,
            delete_folder,
            rename_tag,
            create_smart_folder,
            update_smart_folder,
            delete_smart_folder,
            find_duplicates,
            rebuild_index,
            reveal_item,
            open_item,
            open_url,
            api_info,
            regenerate_api_token,
            import_paths,
            add_watched_folder,
            rename_items,
            set_annotations,
            export_pack,
            export_files,
            import_pack,
            transform_items,
            update_watched_folder,
            remove_watched_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hoard");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end check of the core: needs HOARD_SAMPLES pointing at a folder of sample files.
    #[test]
    fn library_round_trip() {
        let Ok(samples) = std::env::var("HOARD_SAMPLES") else { return };
        let tmp = std::env::temp_dir().join(format!("hoard-test-{}", new_id()));
        fs::create_dir_all(&tmp).unwrap();
        let mut lib = Library::create(&tmp, "Test").unwrap();
        assert!(Library::create(&tmp, "Test").is_err(), "duplicate name must fail");

        let files = import::collect_files(&[samples.clone()]);
        assert!(files.iter().all(|f| !f.to_string_lossy().contains("/.hidden/")), "hidden skipped");
        let seen = std::sync::Mutex::new(std::collections::HashSet::new());
        let items: Vec<Item> = files.iter().filter_map(|f| import::import_file(&lib.root.join("items"), f, None, &seen).unwrap()).collect();
        lib.index_items(&items).unwrap();
        for it in &items {
            println!("{:<12} {:<9} {:>5}x{:<5} thumb={:<10?} dur={:?} palette={:?}",
                it.file_name, it.kind, it.width, it.height, it.thumb, it.duration,
                it.palette.iter().map(|s| format!("{}:{:.2}", s.hex, s.ratio)).collect::<Vec<_>>());
        }
        fn q(lib: &Library, f: impl Fn(&mut Query)) -> Vec<Item> { let mut q = Query { scope: "all".into(), ..Default::default() }; f(&mut q); lib.query(&q).unwrap() }
        assert_eq!(q(&lib, |_| {}).len(), files.len());
        let blue = q(&lib, |q| q.color = Some("#0090ff".into()));
        assert!(blue.iter().any(|i| i.name == "Blue Ocean"), "a nearby blue matches");
        assert!(!blue.iter().any(|i| i.name == "red-poster"), "red does not match blue");
        assert!(q(&lib, |q| q.color = Some("#ff8800".into())).iter().any(|i| i.name == "logo"), "orange finds the SVG");
        assert_eq!(q(&lib, |q| q.text = Some("oce".into())).len(), 1, "prefix search");
        assert_eq!(q(&lib, |q| q.kinds = vec!["video".into()]).len(), 1);

        let red = q(&lib, |q| q.text = Some("red".into()))[0].id.clone();
        let parent = lib.create_folder("Refs", None).unwrap();
        let child = lib.create_folder("Posters", Some(&parent.id)).unwrap();
        lib.update_items(&[red.clone()], &ItemPatch { add_tags: vec!["poster".into(), "red".into()], add_folders: vec![child.id.clone()], rating: Some(4), ..Default::default() }).unwrap();
        assert_eq!(q(&lib, |q| { q.scope = "folder".into(); q.folder_id = Some(parent.id.clone()) }).len(), 1, "parent includes child folders");
        assert_eq!(q(&lib, |q| q.tags = vec!["poster".into()]).len(), 1);
        assert_eq!(q(&lib, |q| q.min_rating = 4).len(), 1);
        assert_eq!(q(&lib, |q| q.text = Some("poster".into())).len(), 1, "tags are searchable");
        let s = lib.stats().unwrap();
        assert_eq!(s.uncategorized, files.len() as i64 - 1);
        assert_eq!(s.tags.len(), 2);

        lib.rename_tag("poster", "Poster Art").unwrap();
        assert_eq!(lib.get(&red).unwrap().tags, vec!["red".to_string(), "Poster Art".to_string()]);
        assert!(lib.move_folder(&parent.id, Some(&child.id)).is_err(), "no folder inside itself");
        lib.delete_folder(&parent.id).unwrap();
        assert!(lib.get(&red).unwrap().folders.is_empty());

        lib.set_trashed(&[red.clone()], true).unwrap();
        assert_eq!(q(&lib, |q| q.scope = "trash".into()).len(), 1);
        assert_eq!(lib.empty_trash().unwrap(), 1);
        assert!(!lib.item_dir(&red).exists());

        // Exact copies are skipped on re-import; a resized copy is a near-duplicate.
        let again = import::collect_files(&[samples.clone()]);
        let known = std::sync::Mutex::new(lib.file_hashes().unwrap());
        let reimported: Vec<_> = again.iter().filter_map(|f| import::import_file(&lib.root.join("items"), f, None, &known).unwrap()).collect();
        // Only the item deleted from the Trash above comes back.
        assert_eq!(reimported.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), vec!["red-poster"], "exact duplicates skipped");
        lib.index_items(&reimported).unwrap();
        let groups = lib.duplicates(8).unwrap();
        assert!(groups.iter().any(|g| g.reason == "similar" && g.items.iter().any(|i| i.name == "pattern") && g.items.iter().any(|i| i.name == "pattern-small")),
            "resized copy found: {:?}", groups.iter().map(|g| g.items.iter().map(|i| i.name.clone()).collect::<Vec<_>>()).collect::<Vec<_>>());
        let pg = groups.iter().find(|g| g.items.iter().any(|i| i.name == "pattern")).unwrap();
        assert_eq!(pg.items[0].name, "pattern", "bigger copy listed first");
        assert!(!pg.items.iter().any(|i| i.kind == "video"), "videos aren't grouped with images");
        assert!(lib.duplicates(0).unwrap().is_empty(), "no exact copies in the library");

        // Smart folders.
        let rule = |f: &str, o: &str, v: &str| Rule { field: f.into(), op: o.into(), value: v.into() };
        let big = lib.create_smart_folder("Wide images", "all", vec![rule("kind", "is", "image"), rule("width", "gte", "1000")]).unwrap();
        let either = lib.create_smart_folder("Video or audio", "any", vec![rule("kind", "is", "video"), rule("kind", "is", "audio")]).unwrap();
        fn names(lib: &Library, id: &str) -> Vec<String> { let mut v: Vec<String> = q(lib, |q| { q.scope = "smart".into(); q.smart_folder_id = Some(id.into()) }).into_iter().map(|i| i.name).collect(); v.sort(); v }
        assert_eq!(names(&lib, &big.id), vec!["Blue Ocean", "pattern"]);
        assert_eq!(names(&lib, &either.id), vec!["clip", "tone"]);
        assert_eq!(lib.stats().unwrap().smart[&either.id], 2);
        lib.update_smart_folder(&big.id, "Landscape", "all", vec![rule("orientation", "is", "landscape"), rule("name", "contains", "pattern")]).unwrap();
        assert_eq!(names(&lib, &big.id), vec!["pattern", "pattern-small"]);
        lib.delete_smart_folder(&either.id).unwrap();
        assert_eq!(lib.meta.smart_folders.len(), 1);

        // Rotate a 1280x720 image: it becomes 720x1280 and its fingerprint changes.
        let pat = q(&lib, |q| q.text = Some("pattern".into())).into_iter().find(|i| i.name == "pattern").unwrap();
        let rotated = lib.transform(&[pat.id.clone()], "cw").unwrap().remove(0);
        assert_eq!((rotated.width, rotated.height), (720, 1280));
        assert_ne!(rotated.fhash, pat.fhash);
        assert!(rotated.thumb.is_some());
        lib.rename_many(&[(pat.id.clone(), "Pattern 001".into())]).unwrap();
        assert_eq!(lib.get(&pat.id).unwrap().name, "Pattern 001");
        assert!(lib.transform(&[q(&lib, |q| q.kinds = vec!["audio".into()])[0].id.clone()], "cw").is_err(), "audio can't rotate");

        // Packs: export two items, import them into a fresh library with their details.
        let two: Vec<String> = q(&lib, |_| {}).into_iter().filter(|i| i.name == "Blue Ocean" || i.name == "logo").map(|i| i.id).collect();
        lib.update_items(&two, &ItemPatch { add_tags: vec!["packed".into()], rating: Some(3), ..Default::default() }).unwrap();
        let pack_path = tmp.join("Refs.hoardpack");
        assert_eq!(pack::export(&lib, &two, &pack_path).unwrap(), 2);
        let mut other = Library::create(&tmp, "Other").unwrap();
        assert_eq!(pack::import(&mut other, &pack_path, &tmp.join("work")).unwrap(), (2, 0));
        let got = other.query(&Query { scope: "all".into(), ..Default::default() }).unwrap();
        assert!(got.iter().all(|i| i.tags.contains(&"packed".to_string()) && i.rating == 3 && i.folders.len() == 1));
        assert_eq!(other.meta.folders[0].name, "Refs");
        assert_eq!(pack::import(&mut other, &pack_path, &tmp.join("work2")).unwrap(), (0, 2), "second import skips copies");
        let out = tmp.join("exported");
        assert_eq!(pack::export_files(&lib, &two, &out).unwrap(), 2);
        assert!(out.join("Blue Ocean.jpg").exists());

        // Area comments are stored clamped and are searchable.
        let blue = q(&lib, |q| q.text = Some("Blue Ocean".into()))[0].id.clone();
        let it = lib.set_annotations(&blue, vec![Annotation { id: String::new(), x: 0.1, y: 0.2, w: 2.0, h: 0.3, text: "nice wave texture".into(), created_at: 0 },
            Annotation { id: String::new(), x: 0.0, y: 0.0, w: 0.1, h: 0.1, text: "  ".into(), created_at: 0 }]).unwrap();
        assert_eq!(it.annotations.len(), 1, "empty comments dropped");
        assert!((it.annotations[0].w - 0.9).abs() < 1e-6, "box kept inside the image");
        assert_eq!(q(&lib, |q| q.text = Some("wave".into()))[0].id, blue);

        // Index is disposable: delete it and reopen.
        let root = lib.root.clone();
        drop(lib);
        for f in ["index.db", "index.db-wal", "index.db-shm"] { let _ = fs::remove_file(root.join(f)); }
        let lib = Library::open(&root).unwrap();
        assert_eq!(lib.stats().unwrap().all, files.len() as i64);
        assert_eq!(lib.meta.smart_folders.len(), 1, "smart folders persist");
        println!("library at {}", root.display());
    }
}
