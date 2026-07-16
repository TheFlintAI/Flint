use serde_json::{json, Value};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::Window;

use super::utils::{emit_command_event, path_from_args, path_kind};
use crate::state::AppState;

// ── File watching ────────────────────────────────────────────────────

pub(crate) fn fs_watch_file(
    window: Window,
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let path = path_from_args(args)?;
    let mut watchers = state
        .file_watchers
        .lock()
        .map_err(|error| error.to_string())?;
    if watchers.contains_key(&path) {
        return Ok(json!({ "success": true, "path": path }));
    }
    let running = Arc::new(AtomicBool::new(true));
    watchers.insert(path.clone(), running.clone());
    thread::spawn(move || {
        let mut previous = watch_snapshot(&path);
        while running.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(800));
            let next = watch_snapshot(&path);
            if next != previous {
                previous = next.clone();
                let _ = emit_command_event(
                    &window,
                    "fs:file-changed",
                    json!({ "path": path, "snapshot": next }),
                );
            }
        }
    });
    Ok(json!({ "success": true }))
}

pub(crate) fn fs_unwatch_file(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let path = path_from_args(args)?;
    if let Some(running) = state
        .file_watchers
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&path)
    {
        running.store(false, Ordering::Relaxed);
    }
    Ok(json!({ "success": true, "path": path }))
}

fn watch_snapshot(path: &str) -> Value {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64);
            json!({
                "exists": true,
                "type": path_kind(&metadata),
                "size": metadata.len(),
                "mtimeMs": modified
            })
        }
        Err(_) => json!({ "exists": false }),
    }
}
