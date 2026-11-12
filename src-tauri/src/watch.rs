//! Watched folders: new files that appear in them are imported automatically.
//!
//! A simple poll every few seconds. A file is imported once its size and
//! modification time have stayed the same for one round, so files that are
//! still being copied or downloaded aren't picked up half-written. Exact
//! copies already in the library are skipped by the normal import.
use crate::{import, import_files, AppState};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const EVERY: Duration = Duration::from_secs(4);

type Snapshot = HashMap<PathBuf, (u64, SystemTime)>;

#[derive(Default)]
struct WatchMemory {
    last: Snapshot,
    done: HashSet<PathBuf>,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Keyed by library root + watch id, so switching libraries starts fresh.
        let mut memory: HashMap<String, WatchMemory> = HashMap::new();
        loop {
            std::thread::sleep(EVERY);
            tick(&app, &mut memory);
        }
    });
}

fn snapshot(path: &str) -> Snapshot {
    import::collect_files(&[path.to_string()])
        .into_iter()
        .filter_map(|p| {
            let m = std::fs::metadata(&p).ok()?;
            Some((p, (m.len(), m.modified().ok()?)))
        })
        .collect()
}

fn tick(app: &AppHandle, memory: &mut HashMap<String, WatchMemory>) {
    let (root, watches) = {
        let st = app.state::<AppState>();
        let Ok(g) = st.lib.lock() else { return };
        let Some(lib) = g.as_ref() else { return };
        (lib.root.to_string_lossy().to_string(), lib.meta.watched.clone())
    };
    for w in watches.iter().filter(|w| w.enabled) {
        let key = format!("{root}|{}", w.id);
        let now = snapshot(&w.path);
        let mem = memory.entry(key).or_default();
        let ready: Vec<PathBuf> = now
            .iter()
            .filter(|(p, stat)| mem.last.get(*p) == Some(*stat) && !mem.done.contains(*p))
            .map(|(p, _)| p.clone())
            .collect();
        // A file that changed gets another chance.
        mem.done.retain(|p| now.get(p).map(|s| mem.last.get(p) == Some(s)).unwrap_or(false));
        mem.last = now;
        if ready.is_empty() {
            continue;
        }
        mem.done.extend(ready.iter().cloned());
        let _ = import_files(app, ready, w.folder_id.clone(), false);
    }
}
