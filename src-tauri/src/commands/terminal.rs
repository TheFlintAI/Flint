use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::Window;

use super::types::{IdArg, ProcessSpawnArgs, ProcessWriteArgs, TerminalResizeArgs};
use super::utils::{
    default_shell, emit_command_event, next_process_id, parse_first_arg,
    started_millis,
};
use crate::utils::home_dir_string;
use crate::state::{AppState, TerminalOutputChunk, TerminalTask};

pub(crate) fn terminal_create(
    window: &Window,
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let mut input = args
        .first()
        .cloned()
        .and_then(|value| serde_json::from_value::<ProcessSpawnArgs>(value).ok())
        .unwrap_or_else(|| ProcessSpawnArgs {
            command: default_shell(),
            cwd: None,
            shell: None,
            title: None,
            cols: None,
            rows: None,
            metadata: None,
        });
    if input.command.trim().is_empty() {
        input.command = default_shell();
    }
    let id = next_process_id(state, "term")?;
    spawn_terminal_pty(window, state, id, input)
}

fn spawn_terminal_pty(
    window: &Window,
    state: &tauri::State<'_, AppState>,
    id: String,
    input: ProcessSpawnArgs,
) -> Result<Value, String> {
    let cwd = resolve_terminal_cwd(input.cwd.as_deref());
    let shell = input.shell.clone().unwrap_or_else(default_shell);
    let command = input.command.trim();
    let command = if command.is_empty() || command.eq_ignore_ascii_case(shell.as_str()) {
        None
    } else {
        Some(command.to_string())
    };
    let title = input
        .title
        .clone()
        .unwrap_or_else(|| shell_name(&shell).to_string());
    let cols = input.cols.unwrap_or(80).max(20);
    let rows = input.rows.unwrap_or(24).max(5);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let mut cmd = CommandBuilder::new(&shell);
    for arg in terminal_shell_args(&shell, command.as_deref()) {
        cmd.arg(arg);
    }
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let writer = Arc::new(Mutex::new(writer));
    let child = Arc::new(Mutex::new(child));
    let output_buffer = Arc::new(Mutex::new(Vec::new()));
    let output_buffer_bytes = Arc::new(Mutex::new(0_usize));
    let next_seq = Arc::new(Mutex::new(0_u64));
    let exit_code = Arc::new(Mutex::new(None));
    state
        .terminal_tasks
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            id.clone(),
            TerminalTask {
                kind: "terminal".to_string(),
                master: pair.master,
                writer,
                child: child.clone(),
                shell: shell.clone(),
                cwd: cwd.clone(),
                cols,
                rows,
                created_at: started_millis(),
                title: title.clone(),
                command: command.clone(),
                output_buffer: output_buffer.clone(),
                exit_code: exit_code.clone(),
            },
        );
    spawn_terminal_reader(
        window.clone(),
        id.clone(),
        "terminal".to_string(),
        reader,
        next_seq,
        output_buffer,
        output_buffer_bytes,
    );
    spawn_terminal_exit_poller(
        window.clone(),
        state.inner().terminal_tasks.clone(),
        id.clone(),
        "terminal".to_string(),
        child,
        exit_code,
    );
    Ok(json!({
        "id": id,
        "success": true,
        "cwd": cwd,
        "shell": shell,
        "cols": cols,
        "rows": rows,
        "createdAt": started_millis(),
        "title": title,
        "command": command
    }))
}

fn resolve_terminal_cwd(cwd: Option<&str>) -> String {
    cwd.filter(|value| Path::new(value).is_dir())
        .map(str::to_string)
        .or_else(|| {
            env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(home_dir_string)
}

fn shell_name(shell: &str) -> &str {
    shell.rsplit(['\\', '/']).next().unwrap_or(shell)
}

fn is_powershell_shell(shell: &str) -> bool {
    matches!(
        shell_name(shell).to_ascii_lowercase().as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    )
}

fn terminal_shell_args(shell: &str, command: Option<&str>) -> Vec<String> {
    if cfg!(windows) {
        if let Some(command) = command {
            if is_powershell_shell(shell) {
                vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-Command".to_string(),
                    command.to_string(),
                ]
            } else {
                vec![
                    "/d".to_string(),
                    "/s".to_string(),
                    "/c".to_string(),
                    command.to_string(),
                ]
            }
        } else if is_powershell_shell(shell) {
            vec!["-NoLogo".to_string()]
        } else {
            Vec::new()
        }
    } else if let Some(command) = command {
        vec!["-lc".to_string(), command.to_string()]
    } else if shell_name(shell) == "sh" {
        Vec::new()
    } else {
        vec!["-i".to_string()]
    }
}

const TERMINAL_OUTPUT_BUFFER_MAX_BYTES: usize = 64 * 1024;

fn spawn_terminal_reader<R: Read + Send + 'static>(
    window: Window,
    id: String,
    event_family: String,
    mut reader: R,
    next_seq: Arc<Mutex<u64>>,
    output_buffer: Arc<Mutex<Vec<TerminalOutputChunk>>>,
    output_buffer_bytes: Arc<Mutex<usize>>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            let Ok(read) = reader.read(&mut buffer) else {
                break;
            };
            if read == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buffer[..read]).to_string();
            let seq =
                append_terminal_output(&data, &next_seq, &output_buffer, &output_buffer_bytes);
            let _ = emit_command_event(
                &window,
                &format!("{event_family}:output"),
                if event_family == "ssh" {
                    json!({
                        "id": id,
                        "taskId": id,
                        "data": general_purpose::STANDARD.encode(data.as_bytes()),
                        "seq": seq
                    })
                } else {
                    json!({ "id": id, "data": data, "seq": seq })
                },
            );
        }
    });
}

fn append_terminal_output(
    data: &str,
    next_seq: &Arc<Mutex<u64>>,
    output_buffer: &Arc<Mutex<Vec<TerminalOutputChunk>>>,
    output_buffer_bytes: &Arc<Mutex<usize>>,
) -> u64 {
    let seq = next_seq
        .lock()
        .map(|mut guard| {
            *guard += 1;
            *guard
        })
        .unwrap_or_default();
    if let (Ok(mut chunks), Ok(mut bytes)) = (output_buffer.lock(), output_buffer_bytes.lock()) {
        chunks.push(TerminalOutputChunk {
            seq,
            data: data.to_string(),
        });
        *bytes += data.len();
        while chunks.len() > 1 && *bytes > TERMINAL_OUTPUT_BUFFER_MAX_BYTES {
            let removed = chunks.remove(0);
            *bytes = bytes.saturating_sub(removed.data.len());
        }
    }
    seq
}

fn spawn_terminal_exit_poller(
    window: Window,
    tasks: Arc<Mutex<BTreeMap<String, TerminalTask>>>,
    id: String,
    _event_family: String,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    exit_code: Arc<Mutex<Option<i32>>>,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(250));
        let status = child
            .lock()
            .ok()
            .and_then(|mut guard| guard.try_wait().ok().flatten());
        let Some(status) = status else {
            continue;
        };
        let code = status.exit_code() as i32;
        if let Ok(mut guard) = exit_code.lock() {
            *guard = Some(code);
        }
        let _ = emit_command_event(
            &window,
            "terminal:exit",
            json!({ "id": id, "exitCode": code }),
        );
        let _ = tasks.lock().map(|mut guard| guard.remove(&id));
        break;
    });
}

pub(crate) fn terminal_input(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<ProcessWriteArgs>(args)?;
    let tasks = state
        .terminal_tasks
        .lock()
        .map_err(|error| error.to_string())?;
    let Some(task) = tasks.get(&input.id) else {
        return Ok(json!({ "success": false, "error": "Terminal not found" }));
    };
    let mut writer = task.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(input.input.as_bytes())
        .map_err(|error| error.to_string())?;
    if input.append_newline.unwrap_or(false) {
        writer.write_all(b"\n").map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub(crate) fn terminal_resize(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<TerminalResizeArgs>(args)?;
    let mut tasks = state
        .terminal_tasks
        .lock()
        .map_err(|error| error.to_string())?;
    let Some(task) = tasks.get_mut(&input.id) else {
        return Ok(json!({ "success": false, "error": "Terminal not found" }));
    };
    let cols = input.cols.max(20);
    let rows = input.rows.max(5);
    task.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    task.cols = cols;
    task.rows = rows;
    Ok(json!({ "success": true }))
}

pub(crate) fn terminal_kill(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<IdArg>(args)?;
    let task = state
        .terminal_tasks
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&input.id);
    let Some(task) = task else {
        return Ok(json!({ "success": false, "error": "Terminal not found" }));
    };
    task.child
        .lock()
        .map_err(|error| error.to_string())?
        .kill()
        .map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub(crate) fn terminal_list(state: &tauri::State<'_, AppState>) -> Result<Value, String> {
    let tasks = state
        .terminal_tasks
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(Value::Array(
        tasks
            .iter()
            .filter_map(|(id, task)| {
                if task.kind != "terminal" {
                    return None;
                }
                let buffer = task
                    .output_buffer
                    .lock()
                    .map(|chunks| {
                        chunks
                            .iter()
                            .map(|chunk| json!({ "seq": chunk.seq, "data": chunk.data }))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                Some(json!({
                    "id": id,
                    "shell": task.shell,
                    "cwd": task.cwd,
                    "cols": task.cols,
                    "rows": task.rows,
                    "createdAt": task.created_at,
                    "title": task.title,
                    "command": task.command,
                    "exitCode": task.exit_code.lock().ok().and_then(|guard| *guard),
                    "buffer": buffer
                }))
            })
            .collect(),
    ))
}
