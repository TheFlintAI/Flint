use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use glob::Pattern;
use tauri::{AppHandle, Emitter, Window};
use tauri_plugin_dialog::DialogExt;

use super::types::{FsEntry, PathArg};
use crate::state::AppState;

pub(crate) fn next_process_id(state: &tauri::State<'_, AppState>, prefix: &str) -> Result<String, String> {
    let mut guard = state
        .next_process_id
        .lock()
        .map_err(|error| error.to_string())?;
    let id = format!("{prefix}-{}", *guard);
    *guard += 1;
    Ok(id)
}

pub(crate) fn emit_command_event(window: &Window, channel: &str, payload: Value) -> Result<(), String> {
    window
        .emit(&format!("command:{channel}"), payload)
        .map_err(|error| error.to_string())
}

/// Broadcast a sync event to ALL windows via `app.emit`.
/// Unlike `emit_command_event` (which uses `window.emit` and echoes only to
/// the sender), this delivers the event to every window.  The frontend sync
/// listener uses the `senderId` field in the envelope to discard its own echo,
/// so cumulative operations (text/thinking deltas, content blocks) are applied
/// exactly once per window.
pub(crate) fn broadcast_command_event(
    app: &AppHandle,
    channel: &str,
    payload: Value,
) -> Result<(), String> {
    app.emit(&format!("command:{channel}"), payload)
        .map_err(|error| error.to_string())
}

pub(crate) fn compile_glob_pattern(pattern: &str) -> Option<Pattern> {
    Pattern::new(pattern).ok()
}

pub(crate) fn visit_files<F>(root: &Path, visitor: &mut F) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<bool, String>,
{
    let metadata = fs::metadata(root).map_err(|error| error.to_string())?;
    if metadata.is_file() {
        visitor(root)?;
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let entry_path = entry.path();
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                if should_skip_dir(&entry_path) {
                    continue;
                }
                stack.push(entry_path);
            } else if metadata.is_file() && !visitor(&entry_path)? {
                return Ok(());
            }
        }
    }
    Ok(())
}

pub(crate) fn should_skip_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git")
            | Some("node_modules")
            | Some("dist")
            | Some("build")
            | Some("target")
            | Some(".next")
            | Some("coverage")
    )
}

pub(crate) fn is_searchable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.len() <= 5 * 1024 * 1024)
        .unwrap_or(false)
}

pub(crate) fn path_allowed(
    path: &Path,
    root: &Path,
    include: Option<&Pattern>,
    exclude: Option<&Pattern>,
) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let normalized = relative.to_string_lossy().replace('\\', "/");
    if exclude.is_some_and(|pattern| pattern.matches(&normalized)) {
        return false;
    }
    include
        .map(|pattern| pattern.matches(&normalized))
        .unwrap_or(true)
}

pub(crate) fn display_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub(crate) fn started_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(crate) fn default_shell() -> String {
    if cfg!(windows) {
        "cmd".to_string()
    } else {
        "sh".to_string()
    }
}

pub(crate) fn parse_first_arg<T: for<'de> Deserialize<'de>>(args: &[Value]) -> Result<T, String> {
    let value = args
        .first()
        .ok_or_else(|| "missing arguments".to_string())?;
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
}

pub(crate) fn path_from_args(args: &[Value]) -> Result<String, String> {
    if let Some(path) = first_string_arg(args) {
        return Ok(path.to_string());
    }
    parse_first_arg::<PathArg>(args).map(|arg| arg.path)
}

pub(crate) fn stat_path(path: &str) -> Result<Value, String> {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64);
            Ok(json!({
                "success": true,
                "exists": true,
                "type": path_kind(&metadata),
                "path": path,
                "name": Path::new(path)
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default(),
                "is_dir": metadata.is_dir(),
                "is_file": metadata.is_file(),
                "size": metadata.len(),
                "modified": modified,
                "mtimeMs": modified
            }))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({
            "success": true,
            "exists": false,
            "type": Value::Null,
            "path": path,
            "size": Value::Null,
            "mtimeMs": Value::Null
        })),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn stat_entry(path: PathBuf) -> Result<FsEntry, String> {
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(FsEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        size: metadata.len(),
        modified,
    })
}

pub(crate) fn path_kind(metadata: &fs::Metadata) -> &'static str {
    if metadata.is_file() {
        "file"
    } else if metadata.is_dir() {
        "directory"
    } else {
        "other"
    }
}

pub(crate) fn build_file_dialog(
    window: &Window,
    args: &[Value],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut dialog = window.dialog().file();
    if let Some(filters) = args
        .first()
        .and_then(|v| v.get("filters"))
        .and_then(Value::as_array)
    {
        for filter in filters {
            let Some(name) = filter.get("name").and_then(Value::as_str) else {
                continue;
            };
            let Some(exts) = filter.get("extensions").and_then(Value::as_array) else {
                continue;
            };
            let ext_refs: Vec<&str> = exts.iter().filter_map(|e| e.as_str()).collect();
            if !ext_refs.is_empty() {
                dialog = dialog.add_filter(name, &ext_refs);
            }
        }
    }
    dialog
}

pub(crate) fn dialog_result(path: Option<tauri_plugin_dialog::FilePath>) -> Value {
    match path.and_then(|value| value.into_path().ok()) {
        Some(path) => json!({
            "success": true,
            "canceled": false,
            "path": path.to_string_lossy().to_string()
        }),
        None => json!({
            "success": false,
            "canceled": true
        }),
    }
}

pub(crate) fn first_string_arg(args: &[Value]) -> Option<&str> {
    args.first().and_then(|value| value.as_str()).or_else(|| {
        args.first()
            .and_then(|value| value.get("path").or_else(|| value.get("url")))
            .and_then(Value::as_str)
    })
}
