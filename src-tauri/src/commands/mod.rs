mod desktop;
mod fs;
mod image;
mod process;
mod terminal;
pub(crate) mod types;
pub(crate) mod utils;

use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::env;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_dialog::DialogExt;

use crate::http_client::ApiRequestArgs;
use crate::state::AppState;
use crate::utils::{flint_path, home_dir};
use types::*;
use utils::*;

// ── Tauri command handlers ────────────────────────────────────────

#[tauri::command]
fn app_platform() -> String {
    match env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        "linux" => "linux",
        other => other,
    }
    .to_string()
}

#[tauri::command]
fn app_versions(window: Window) -> RuntimeVersions {
    RuntimeVersions {
        tauri: window.package_info().version.to_string(),
        webview: None,
        chrome: None,
    }
}

#[tauri::command]
async fn invoke_app_command(
    window: Window,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match channel.as_str() {
        "window:minimize" => {
            window.minimize().map_err(|error| error.to_string())?;
            Ok(json!(true))
        }
        "window:maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
            // Emit the new maximized state so the frontend can update the icon
            let _ = window.emit("command:window:maximized", window.is_maximized().unwrap_or(false));
            Ok(json!(true))
        }
        "window:close" => {
            window.close().map_err(|error| error.to_string())?;
            Ok(json!(true))
        }
        "window:isMaximized" => Ok(json!(window
            .is_maximized()
            .map_err(|error| error.to_string())?)),
        "shell:openExternal" | "shell:openPath" => {
            let target = first_string_arg(&args)
                .ok_or_else(|| format!("{channel} requires a target path or URL"))?;
            open::that(target).map_err(|error| error.to_string())?;
            Ok(json!({ "success": true }))
        }
        "app:homedir" => Ok(json!(home_dir().to_string_lossy().to_string())),
        "app:system-info" => Ok(json!({
            "platform": app_platform(),
            "arch": env::consts::ARCH,
            "homedir": home_dir().to_string_lossy().to_string()
        })),
        "fs:read-file" | "fs:read-document" => {
            let input = parse_first_arg::<ReadFileArgs>(&args)?;
            read_file_text(&input)
        }
        "fs:read-file-binary" => {
            let path = path_from_args(&args)?;
            let data = std::fs::read(&path).map_err(|error| error.to_string())?;
            Ok(json!({
                "success": true,
                "data": general_purpose::STANDARD.encode(data),
                "path": path
            }))
        }
        "fs:write-file" => {
            let write = parse_first_arg::<WriteFileArgs>(&args)?;
            if let Some(parent) = Path::new(&write.path).parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(&write.path, write.content).map_err(|error| error.to_string())?;
            Ok(json!({ "success": true, "path": write.path }))
        }
        "fs:write-file-binary" => {
            let write = parse_first_arg::<WriteBinaryFileArgs>(&args)?;
            if let Some(parent) = Path::new(&write.path).parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let bytes = general_purpose::STANDARD
                .decode(write.data)
                .map_err(|error| error.to_string())?;
            std::fs::write(&write.path, bytes).map_err(|error| error.to_string())?;
            Ok(json!({ "success": true, "path": write.path }))
        }
        "fs:stat-path" => {
            let path = path_from_args(&args)?;
            Ok(json!({ "success": true, "stat": stat_path(&path)? }))
        }
        "fs:list-dir" => {
            let list = parse_first_arg::<ListDirArgs>(&args)?;
            let ignore_patterns = list
                .ignore
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .filter_map(|pattern| compile_glob_pattern(pattern))
                .collect::<Vec<_>>();
            let mut entries = Vec::new();
            let mut has_more = false;
            for entry in std::fs::read_dir(&list.path).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let name = entry.file_name().to_string_lossy().to_string();
                if ignore_patterns.iter().any(|pattern| pattern.matches(&name)) {
                    continue;
                }
                if let Some(limit) = list.limit {
                    if entries.len() >= limit {
                        has_more = true;
                        break;
                    }
                }
                entries.push(stat_entry(entry.path())?);
            }
            Ok(json!({ "success": true, "entries": entries, "hasMore": has_more }))
        }
        "fs:mkdir" => {
            let path = path_from_args(&args)?;
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            Ok(json!({ "success": true, "path": path }))
        }
        "fs:delete" => {
            let path = path_from_args(&args)?;
            let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                std::fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
            } else {
                std::fs::remove_file(&path).map_err(|error| error.to_string())?;
            }
            Ok(json!({ "success": true, "path": path }))
        }
        "fs:move" => {
            let value = args
                .first()
                .ok_or_else(|| "fs:move requires args".to_string())?;
            let from = value
                .get("from")
                .and_then(Value::as_str)
                .ok_or_else(|| "fs:move requires from".to_string())?;
            let to = value
                .get("to")
                .and_then(Value::as_str)
                .ok_or_else(|| "fs:move requires to".to_string())?;
            if let Some(parent) = Path::new(to).parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::rename(from, to).map_err(|error| error.to_string())?;
            Ok(json!({ "success": true, "from": from, "to": to }))
        }
        "fs:glob" => {
            let input = parse_first_arg::<GlobArgs>(&args)?;
            let pattern = input
                .cwd
                .map(|cwd| {
                    Path::new(&cwd)
                        .join(&input.pattern)
                        .to_string_lossy()
                        .to_string()
                })
                .unwrap_or(input.pattern);
            let paths = glob::glob(&pattern)
                .map_err(|error| error.to_string())?
                .filter_map(Result::ok)
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            Ok(json!({ "success": true, "paths": paths }))
        }
        "fs:grep" => fs::grep_files(&args),
        "fs:watch-file" => fs::fs_watch_file(window.clone(), &state, &args),
        "fs:unwatch-file" => fs::fs_unwatch_file(&state, &args),
        "fs:select-file" => Ok(dialog_result(
            build_file_dialog(&window, &args).blocking_pick_file(),
        )),
        "fs:select-save-file" => Ok(dialog_result(window.dialog().file().blocking_save_file())),
        "fs:select-folder" => Ok(dialog_result(window.dialog().file().blocking_pick_folder())),
        "shell:exec" => process::shell_exec(&window, &args),
        "process:spawn" => process::process_spawn(&window, &state, &args),
        "process:kill" => process::process_kill(&state, &args),
        "process:write" => process::process_write(&state, &args),
        "process:status" => process::process_status(&state, &args),
        "process:list" => process::process_list(&state),
        "terminal:create" => terminal::terminal_create(&window, &state, &args),
        "terminal:input" => terminal::terminal_input(&state, &args),
        "terminal:resize" => terminal::terminal_resize(&state, &args),
        "terminal:kill" => terminal::terminal_kill(&state, &args),
        "terminal:list" => terminal::terminal_list(&state),
        "api:request" => {
            let owned_args = args.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let request = parse_first_arg::<ApiRequestArgs>(&owned_args)?;
                crate::http_client::request(request)
            })
            .await
            .map_err(|e| e.to_string())?
        }
        channel if channel.starts_with("git:") => crate::git::handle_channel(channel, &args),
        channel
            if channel.starts_with("api:")
                || channel.starts_with("oauth:")
                || channel.starts_with("image:")
                || channel.starts_with("clipboard:")
                || channel.starts_with("desktop:")
                || channel.starts_with("task-runtime:")
                || channel.starts_with("agent-runtime:")
                || channel == "window:capture-region" =>
        {
            handle_misc_channel(&window, &app, &state, channel, &args)
        }

        channel if channel.starts_with("plugin:") => {
            crate::plugin::commands::handle_channel(&app, &state, channel, &args)
        }
        channel if channel.starts_with("memory:") => {
            crate::memory::commands::handle_memory_channel(&state, channel, &args).await
        }
        "provider:get-builtin-presets" => {
            let pm = &state.preset_manager;
            if pm.len() == 0 {
                let presets_dir = app
                    .path()
                    .resolve("presets", tauri::path::BaseDirectory::Resource)
                    .map_err(|e| format!("resolve resource path: {e}"))?;
                let user_dir = flint_path("presets");
                let _ = std::fs::create_dir_all(&user_dir);
                tracing::debug!("[provider:get-builtin-presets] presets_dir={}", presets_dir.display());
                if let Err(e) = pm.load_from_dir(&presets_dir) {
                    tracing::warn!("[provider:get-builtin-presets] resource dir error: {e}");
                }
                if user_dir.exists() {
                    let _ = pm.load_from_dir(&user_dir);
                }
                tracing::debug!("[provider:get-builtin-presets] loaded {} presets", pm.len());
            }
            Ok(pm.get_all_json())
        }
        _ => Err(format!("Unknown Tauri command channel: {channel}")),
    }
}

#[tauri::command]
async fn emit_app_command(
    window: Window,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> Result<(), String> {
    if channel == "api:stream-request" {
        let request = parse_first_arg::<ApiRequestArgs>(&args)?;
        crate::http_client::spawn_http_stream(window, request, emit_command_event);
        return Ok(());
    }
    if channel == "terminal:input" || channel == "process:write" {
        process::process_write(&state, &args)?;
        return Ok(());
    }
    // Use app.emit to broadcast to ALL windows (not just the sender).
    // The frontend sync listener filters self-originated events by senderId,
    // so each window only processes events from other windows/webviews.
    app.emit(
        &format!("command:{channel}"),
        args.first().cloned().unwrap_or(Value::Null),
    )
    .map_err(|error| error.to_string())
}

/// Read a text file, optionally restricted to a 1-indexed line range.
/// Returns `{ content, path }`, with `truncated`/`totalLines` when a range is applied.
fn read_file_text(input: &ReadFileArgs) -> Result<Value, String> {
    let path = &input.path;
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(json!({ "notFound": true, "path": path }));
        }
        Err(error) => return Err(error.to_string()),
    };

    if input.offset.is_none() && input.limit.is_none() {
        return Ok(json!({ "content": content, "path": path }));
    }

    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let total = lines.len();
    let start = input.offset.unwrap_or(1).saturating_sub(1).min(total);
    let end = match input.limit {
        Some(limit) => start.saturating_add(limit).min(total),
        None => total,
    };
    let sliced: String = lines[start..end].concat();
    let truncated = end < total;
    Ok(json!({ "content": sliced, "path": path, "truncated": truncated, "totalLines": total }))
}

// ── Misc channel handler (native-only commands) ────────────────────

fn handle_misc_channel(
    window: &Window,
    app: &AppHandle,
    _state: &tauri::State<'_, AppState>,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    match channel {
        "api:stream-request" => {
            let request = parse_first_arg::<ApiRequestArgs>(args)?;
            crate::http_client::spawn_http_stream(window.clone(), request, emit_command_event);
            Ok(json!({ "success": true }))
        }
        "image:persist-generated" => image::persist_generated_image(args),
        "image:download" => image::image_download(args),
        "image:fetch-base64" => image::image_fetch_base64(args),
        "image:create-gif-from-grid" => image::create_gif_from_grid(args),
        "clipboard:write-image" => image::clipboard_write_image(args),
        "clipboard:read-text" => image::clipboard_read_text(),
        "clipboard:write-text" => image::clipboard_write_text(args),
        "clipboard:read-image" => image::clipboard_read_image(),
        "desktop:screenshot:capture" | "window:capture-region" => desktop::desktop_screenshot_capture(),
        "desktop:input:click" => desktop::desktop_input_click(args),
        "desktop:input:type" => desktop::desktop_input_type(args),
        "desktop:input:scroll" => desktop::desktop_input_scroll(args),
        "task-runtime:sync" | "agent-runtime:sync" => {
            broadcast_command_event(app, channel, args.first().cloned().unwrap_or(Value::Null))?;
            Ok(json!({ "success": true }))
        }
        _ => Err(format!("Unknown Tauri command channel: {channel}")),
    }
}

// ── Entry point ───────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::load())
        .invoke_handler(tauri::generate_handler![
            app_platform,
            app_versions,
            invoke_app_command,
            emit_app_command
        ])
        .setup(|_app| {
            // Initialize memory system. The embedding model is bundled as a
            // resource and resolved via Tauri in both dev and production.
            let memory_db_path = flint_path("memory.db");
            let model_dir = _app
                .path()
                .resolve(
                    "embeddings/embeddinggemma-300m",
                    tauri::path::BaseDirectory::Resource,
                )
                .expect("Failed to resolve embedding model resource path");
            let state = _app.state::<AppState>();
            state.init_memory(&memory_db_path, &model_dir);

            #[cfg(debug_assertions)]
            {
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            // Listen for window state changes (e.g. double-click titlebar) to keep the
            // frontend maximize/restore icon in sync with the actual window state.
            if let Some(window) = _app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        let _ = w.emit("command:window:maximized", w.is_maximized().unwrap_or(false));
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Flint Tauri application");
}
