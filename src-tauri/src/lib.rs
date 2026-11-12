mod import;
mod library;
mod model;
mod palette;

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
fn open_url(url: String) -> R<()> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only web links can be opened".into());
    }
    std::process::Command::new("/usr/bin/open").arg(url).spawn().map_err(err)?;
    Ok(())
}

/// Copies files into the library in batches so the grid fills in as it goes.
#[tauri::command]
async fn import_paths(app: AppHandle, paths: Vec<String>, folder_id: Option<String>) -> R<usize> {
    let root = {
        let st = app.state::<AppState>();
        let g = st.lib.lock().map_err(err)?;
        g.as_ref().map(|l| l.root.clone()).ok_or_else(|| "No library is open".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || -> R<usize> {
        let files = import::collect_files(&paths);
        let total = files.len();
        let items_dir = root.join("items");
        let done = AtomicUsize::new(0);
        let failed = AtomicUsize::new(0);
        let pool = rayon::ThreadPoolBuilder::new().num_threads(4).build().map_err(err)?;
        let _ = app.emit("import-progress", ImportProgress { done: 0, total, failed: 0 });
        let mut imported = 0;
        for chunk in files.chunks(24) {
            let items: Vec<Item> = pool.install(|| {
                chunk
                    .par_iter()
                    .filter_map(|f| {
                        let r = import::import_file(&items_dir, f, folder_id.as_deref());
                        if r.is_err() {
                            failed.fetch_add(1, Ordering::SeqCst);
                        }
                        let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                        let _ = app.emit(
                            "import-progress",
                            ImportProgress { done: d, total, failed: failed.load(Ordering::SeqCst) },
                        );
                        r.ok()
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
            let _ = app.emit("items-imported", imported);
        }
        Ok(imported)
    })
    .await
    .map_err(err)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
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
            rebuild_index,
            reveal_item,
            open_item,
            open_url,
            import_paths
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
        let items: Vec<Item> = files.iter().map(|f| import::import_file(&lib.root.join("items"), f, None).unwrap()).collect();
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

        // Index is disposable: delete it and reopen.
        let root = lib.root.clone();
        drop(lib);
        for f in ["index.db", "index.db-wal", "index.db-shm"] { let _ = fs::remove_file(root.join(f)); }
        let lib = Library::open(&root).unwrap();
        assert_eq!(lib.stats().unwrap().all, files.len() as i64 - 1);
        println!("library at {}", root.display());
    }
}
