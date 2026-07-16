mod desktop;
mod fs;
mod image;
mod process;
mod reader;
mod search;
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
        "notification:send" => {
            let opts = parse_first_arg::<NotifyOptions>(&args)?;
            let task_id = opts.task_id.clone();
            let win = window.clone();
            let app_handle = app.clone();

            send_os_notification(app_handle, opts, task_id, win)?;

            Ok(json!(true))
        }
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
            reader::read_file(&input.path, input.offset, input.limit, input.pages.as_deref())
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
        "fs:glob" => search::glob_files(&args),
        "fs:grep" => search::grep_files(&args),
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
        "log:write" => {
            let level = args
                .first()
                .and_then(|v| v.get("level"))
                .and_then(Value::as_str)
                .unwrap_or("info");
            let tag = args
                .first()
                .and_then(|v| v.get("tag"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let message = args
                .first()
                .and_then(|v| v.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("");
            match level {
                "trace" => tracing::trace!("[{tag}] {message}"),
                "debug" => tracing::debug!("[{tag}] {message}"),
                "info" => tracing::info!("[{tag}] {message}"),
                "warn" => tracing::warn!("[{tag}] {message}"),
                "error" => tracing::error!("[{tag}] {message}"),
                _ => tracing::info!("[{tag}] {message}"),
            }
            Ok(json!(true))
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
        _ => {
            tracing::warn!("[command] unknown channel: {channel}");
            Err(format!("Unknown Tauri command channel: {channel}"))
        }
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
        _ => {
            tracing::warn!("[command] unknown misc channel: {channel}");
            Err(format!("Unknown Tauri command channel: {channel}"))
        }
    }
}

// ── OS notification ──────────────────────────────────────────────────

/// Sends an OS-level notification.
///
/// On **Windows** uses `tauri-winrt-notification` directly with an
/// `on_activated` callback — clicking the toast restores the minimised
/// window and emits `command:notification:clicked` for task navigation.
/// A Start Menu shortcut (created during setup) provides the AUMI so
/// toasts show **Flint** branding even in dev mode.
///
/// On **other platforms** delegates to `notify-rust`.
fn send_os_notification(
    app_handle: AppHandle,
    opts: NotifyOptions,
    task_id: String,
    win: Window,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let app_id = app_handle.config().identifier.clone();
        let ah = app_handle.clone();
        let tid = task_id.clone();
        let w = win.clone();
        tauri_winrt_notification::Toast::new(&app_id)
            .title(&opts.title)
            .text1(&opts.body)
            .on_activated(move |_action| {
                let ah2 = ah.clone();
                let w2 = w.clone();
                let tid2 = tid.clone();
                let _ = ah.run_on_main_thread(move || {
                    // `hide` first is required on Windows when the
                    // window is minimised (tauri#8361).
                    let _ = w2.hide();
                    let _ = w2.unminimize();
                    let _ = w2.set_focus();
                    let _ = w2.show();
                });
                let _ = ah2.emit(
                    "command:notification:clicked",
                    serde_json::json!({ "taskId": tid2 }),
                );
                Ok(())
            })
            .show()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let app_id = app_handle.config().identifier.clone();
        let mut notification = notify_rust::Notification::new();
        notification.app_id(&app_id);
        notification.summary(&opts.title);
        notification.body(&opts.body);

        let handle = notification.show().map_err(|error| error.to_string())?;

        let ah = app_handle.clone();
        let w = win.clone();
        let tid = task_id.clone();
        std::thread::spawn(move || {
            handle.wait_for_action(|action| {
                if action == "__closed" {
                    return;
                }
                let emit_handle = ah.clone();
                let _ = ah.run_on_main_thread(move || {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                    let _ = emit_handle.emit(
                        "command:notification:clicked",
                        serde_json::json!({ "taskId": tid }),
                    );
                });
            });
        });
    }

    Ok(())
}

// ── Windows Start Menu shortcut ──────────────────────────────────────

/// Creates a Start Menu shortcut with AppUserModelID.
/// Step 1: `shortcuts-rs` (pure Rust) creates the basic `.lnk`.
/// Step 2: `SHGetPropertyStoreFromParsingName` (shell32 FFI) stamps
///          the AppUserModelID via IPropertyStore COM.
#[cfg(target_os = "windows")]
fn ensure_startmenu_shortcut(app_id: &str) {
    let exe = std::env::current_exe().unwrap_or_default();
    let shortcut_dir = format!(
        "{}\\Microsoft\\Windows\\Start Menu\\Programs\\Flint",
        std::env::var("APPDATA").unwrap_or_default()
    );
    let shortcut_path = format!("{}\\Flint.lnk", shortcut_dir);

    let _ = std::fs::remove_file(&shortcut_path);
    let _ = std::fs::create_dir_all(&shortcut_dir);

    tracing::info!("[startmenu] creating: {}", shortcut_path);

    match shortcuts_rs::ShellLink::new(&exe, None, None, None) {
        Ok(sl) => {
            let mut sl = sl;
            if let Some(parent) = exe.parent() {
                sl.set_working_dir(Some(parent.to_string_lossy().into_owned()));
            }
            if let Err(e) = sl.create_lnk(&shortcut_path) {
                tracing::warn!("[startmenu] create_lnk failed: {e}");
                return;
            }
        }
        Err(e) => {
            tracing::warn!("[startmenu] ShellLink::new failed: {e}");
            return;
        }
    }

    // Stamp AppUserModelID onto the shortcut via IPropertyStore COM.
    match stamp_app_user_model_id(&shortcut_path, app_id) {
        Ok(()) => tracing::info!("[startmenu] shortcut created successfully"),
        Err(e) => tracing::warn!("[startmenu] AUMI stamp failed: {e}"),
    }
}

#[cfg(target_os = "windows")]
fn stamp_app_user_model_id(lnk_path: &str, app_id: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // COM interface IDs
    let iid_property_store: windows_core::GUID =
        windows_core::GUID::from_u128(0x886D8EEB_8CF2_4446_8D02_CDBA1DBDCF99);

    // PKEY_AppUserModel_ID
    #[repr(C)]
    struct PropertyKey {
        fmtid: windows_core::GUID,
        pid: u32,
    }

    #[repr(C)]
    struct PropVariant {
        vt: u16,
        _reserved1: u16,
        _reserved2: u16,
        _reserved3: u16,
        ptr: *const u16,
    }

    #[repr(C)]
    struct IPropertyStoreVtbl {
        // IUnknown
        query_interface: unsafe extern "system" fn(
            this: *mut *const IPropertyStoreVtbl,
            riid: *const windows_core::GUID,
            ppv: *mut *mut std::ffi::c_void,
        ) -> i32,
        add_ref: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl) -> u32,
        release: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl) -> u32,
        // IPropertyStore
        get_count: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl, *mut u32) -> i32,
        get_at: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl, u32, *mut PropertyKey) -> i32,
        get_value: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl, *const PropertyKey, *mut PropVariant) -> i32,
        set_value: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl, *const PropertyKey, *const PropVariant) -> i32,
        commit: unsafe extern "system" fn(*mut *const IPropertyStoreVtbl) -> i32,
    }

    // shell32!SHGetPropertyStoreFromParsingName
    #[link(name = "shell32")]
    extern "system" {
        fn SHGetPropertyStoreFromParsingName(
            pszPath: *const u16,
            pbc: *const std::ffi::c_void,
            flags: u32,
            riid: *const windows_core::GUID,
            ppv: *mut *mut *const IPropertyStoreVtbl,
        ) -> i32;
    }

    let wide_path: Vec<u16> = OsStr::new(lnk_path)
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut store: *mut *const IPropertyStoreVtbl = std::ptr::null_mut();

    // GETPROPERTYSTOREFLAGS_READWRITE = 0x00000002
    let hr = unsafe {
        SHGetPropertyStoreFromParsingName(
            wide_path.as_ptr(),
            std::ptr::null(),
            0x00000002, // GPS_READWRITE
            &iid_property_store,
            &mut store,
        )
    };

    if hr < 0 || store.is_null() {
        return Err(format!("SHGetPropertyStoreFromParsingName failed: 0x{hr:08X}"));
    }

    let key = PropertyKey {
        fmtid: windows_core::GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
        pid: 5,
    };

    let wide_id: Vec<u16> = OsStr::new(app_id).encode_wide().chain(Some(0)).collect();

    let pv = PropVariant {
        vt: 31, // VT_LPWSTR
        _reserved1: 0,
        _reserved2: 0,
        _reserved3: 0,
        ptr: wide_id.as_ptr(),
    };

    let hr = unsafe {
        let vtbl = &**store;
        (vtbl.set_value)(store, &key, &pv)
    };
    if hr < 0 {
        return Err(format!("IPropertyStore::SetValue failed: 0x{hr:08X}"));
    }

    let hr = unsafe {
        let vtbl = &**store;
        (vtbl.commit)(store)
    };
    if hr < 0 {
        return Err(format!("IPropertyStore::Commit failed: 0x{hr:08X}"));
    }

    unsafe {
        let vtbl = &**store;
        (vtbl.release)(store)
    };

    Ok(())
}

/// Cleans up the Start Menu shortcut created during dev setup.
/// Only meaningful on Windows where the shortcut is created.
#[cfg(target_os = "windows")]
fn cleanup_startmenu_shortcut() {
    let shortcut_path = format!(
        "{}\\Microsoft\\Windows\\Start Menu\\Programs\\Flint\\Flint.lnk",
        std::env::var("APPDATA").unwrap_or_default()
    );
    if std::path::Path::new(&shortcut_path).exists() {
        match std::fs::remove_file(&shortcut_path) {
            Ok(()) => tracing::info!("[startmenu] cleaned up: {}", shortcut_path),
            Err(e) => tracing::warn!("[startmenu] cleanup failed: {e}"),
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::load())
        .invoke_handler(tauri::generate_handler![
            app_platform,
            app_versions,
            invoke_app_command,
            emit_app_command
        ])
        .setup(|_app| {
            tracing::info!("Flint app starting up");
            // Required for Windows to route toast notification clicks back to
            // the running process (matching the app_id set on each toast).
            #[cfg(windows)]
            {
                let app_id = _app.config().identifier.clone();
                let app_id_wide: Vec<u16> = format!("{}\0", app_id).encode_utf16().collect();
                #[link(name = "shell32")]
                extern "system" {
                    fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
                }
                unsafe { SetCurrentProcessExplicitAppUserModelID(app_id_wide.as_ptr()) };
                // Create Start Menu shortcut so Windows toast notifications
                // show Flint branding (requires shortcut with matching AUMI).
                ensure_startmenu_shortcut(&app_id);
            }
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
                    if let tauri::WindowEvent::Destroyed = event {
                        #[cfg(all(debug_assertions, target_os = "windows"))]
                        cleanup_startmenu_shortcut();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Flint Tauri application");
}
