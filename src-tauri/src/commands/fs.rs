use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Window;

use super::types::GrepArgs;
use super::utils::{
    compile_glob_pattern, display_path, emit_command_event, is_searchable_file, parse_first_arg,
    path_allowed, path_from_args, path_kind, visit_files,
};
use crate::state::AppState;

pub(crate) fn grep_files(args: &[Value]) -> Result<Value, String> {
    let input = parse_first_arg::<GrepArgs>(args)?;
    let started = Instant::now();
    let root = input.path.unwrap_or_else(|| ".".to_string());
    let root_path = PathBuf::from(&root);
    let output_mode = input
        .output_mode
        .unwrap_or_else(|| "files_with_matches".to_string());
    let max_results = input.max_results.unwrap_or(100).min(1000);
    let max_line_length = input.max_line_length.unwrap_or(500).min(4000);
    let include = input.include.as_deref().and_then(compile_glob_pattern);
    let exclude = input.exclude.as_deref().and_then(compile_glob_pattern);
    let case_insensitive =
        input.ignore_case.unwrap_or(false) || !input.case_sensitive.unwrap_or(true);
    let matcher = if input.literal.unwrap_or(false) {
        None
    } else {
        Some(
            regex::RegexBuilder::new(&input.pattern)
                .case_insensitive(case_insensitive)
                .build()
                .map_err(|error| error.to_string())?,
        )
    };
    let literal = if case_insensitive {
        input.pattern.to_lowercase()
    } else {
        input.pattern.clone()
    };
    let mut matches = Vec::new();
    let mut truncated = false;

    visit_files(&root_path, &mut |path| {
        if matches.len() >= max_results {
            truncated = true;
            return Ok(false);
        }
        if !path.is_file() || !is_searchable_file(path) {
            return Ok(true);
        }
        if !path_allowed(path, &root_path, include.as_ref(), exclude.as_ref()) {
            return Ok(true);
        }
        let file = fs::File::open(path).map_err(|error| error.to_string())?;
        let reader = BufReader::new(file);
        let mut count = 0usize;
        for (index, line) in reader.lines().enumerate() {
            let line = line.map_err(|error| error.to_string())?;
            let haystack = if case_insensitive {
                line.to_lowercase()
            } else {
                line.clone()
            };
            let found = matcher
                .as_ref()
                .map(|regex| regex.find(&line).map(|m| m.start() + 1))
                .unwrap_or_else(|| haystack.find(&literal).map(|offset| offset + 1));
            if let Some(column) = found {
                count += 1;
                if output_mode == "count" {
                    continue;
                }
                if output_mode == "files_with_matches" {
                    matches.push(json!({ "path": display_path(path, &root_path) }));
                    return Ok(matches.len() < max_results);
                }
                let text = if line.chars().count() > max_line_length {
                    format!(
                        "{}...",
                        line.chars().take(max_line_length).collect::<String>()
                    )
                } else {
                    line
                };
                matches.push(json!({
                    "path": display_path(path, &root_path),
                    "line": index + 1,
                    "column": column,
                    "text": text,
                    "kind": "match"
                }));
                if matches.len() >= max_results {
                    truncated = true;
                    return Ok(false);
                }
            }
        }
        if output_mode == "count" && count > 0 {
            matches.push(json!({
                "path": display_path(path, &root_path),
                "count": count
            }));
        }
        Ok(true)
    })?;

    Ok(json!({
        "kind": "grep",
        "matches": matches,
        "meta": {
            "backend": "local",
            "engine": "rust_fallback",
            "searchRoot": root,
            "pathStyle": "relative_to_search_root",
            "truncated": truncated,
            "timedOut": false,
            "limitReason": if truncated { json!("max_results") } else { Value::Null },
            "pattern": input.pattern,
            "outputMode": output_mode,
            "searchTime": started.elapsed().as_millis()
        }
    }))
}

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
