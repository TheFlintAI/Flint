use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use shared_child::SharedChild;
use tauri::{Emitter, Window};

use super::types::{IdArg, ProcessSpawnArgs, ProcessWriteArgs, ShellExecArgs};
use super::utils::{default_shell, emit_command_event, next_process_id, parse_first_arg, started_millis};
use crate::state::{AppState, ManagedProcess};

pub(crate) fn shell_exec(window: &Window, args: &[Value]) -> Result<Value, String> {
    let input = parse_first_arg::<ShellExecArgs>(args)?;
    let exec_id = input
        .exec_id
        .unwrap_or_else(|| format!("exec-{}", started_millis()));
    let shell = input.shell.unwrap_or_else(default_shell);
    let mut command = Command::new(&shell);
    if cfg!(windows) {
        if shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh") {
            command.arg("-Command").arg(&input.command);
        } else {
            command.arg("/C").arg(&input.command);
        }
    } else {
        command.arg("-lc").arg(&input.command);
    }
    if let Some(cwd) = input.cwd.as_deref() {
        command.current_dir(cwd);
    }
    window
        .emit(
            "command:shell:started",
            json!({ "execId": exec_id, "processId": Value::Null, "terminalId": Value::Null }),
        )
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    let output = command.output().map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stdout.is_empty() {
        window
            .emit(
                "command:shell:output",
                json!({ "execId": exec_id, "chunk": stdout, "stream": "stdout" }),
            )
            .map_err(|error| error.to_string())?;
    }
    if !stderr.is_empty() {
        window
            .emit(
                "command:shell:output",
                json!({ "execId": exec_id, "chunk": stderr, "stream": "stderr" }),
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(json!({
        "exitCode": output.status.code().unwrap_or(-1),
        "stdout": stdout,
        "stderr": stderr,
        "processId": Value::Null,
        "terminalId": Value::Null,
        "summary": {
            "mode": "full",
            "executionEngine": "tauri",
            "totalMs": started.elapsed().as_millis(),
            "shell": shell
        }
    }))
}

pub(crate) fn process_spawn(
    window: &Window,
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<ProcessSpawnArgs>(args)?;
    let id = next_process_id(state, "proc")?;
    spawn_managed_process(window, state, id, input, "process")
}

fn spawn_managed_process(
    window: &Window,
    state: &tauri::State<'_, AppState>,
    id: String,
    input: ProcessSpawnArgs,
    event_family: &str,
) -> Result<Value, String> {
    let cwd = input.cwd.unwrap_or_else(|| {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .to_string_lossy()
            .to_string()
    });
    let shell = input.shell.unwrap_or_else(default_shell);
    let mut command = Command::new(&shell);
    if cfg!(windows) {
        if shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh") {
            command.arg("-NoLogo").arg("-Command").arg(&input.command);
        } else {
            command.arg("/C").arg(&input.command);
        }
    } else {
        command.arg("-lc").arg(&input.command);
    }
    command
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdin = Arc::new(Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let shared = Arc::new(SharedChild::new(child).map_err(|error| error.to_string())?);
    let port = Arc::new(Mutex::new(None));
    let metadata = input.metadata.unwrap_or(Value::Null);
    state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            id.clone(),
            ManagedProcess {
                child: shared.clone(),
                stdin,
                command: input.command.clone(),
                cwd: cwd.clone(),
                created_at: started_millis(),
                port: port.clone(),
                metadata: metadata.clone(),
            },
        );
    if let Some(stdout) = stdout {
        spawn_process_reader(
            window.clone(),
            id.clone(),
            stdout,
            "stdout",
            event_family,
            port.clone(),
            metadata.clone(),
        );
    }
    if let Some(stderr) = stderr {
        spawn_process_reader(
            window.clone(),
            id.clone(),
            stderr,
            "stderr",
            event_family,
            port.clone(),
            metadata.clone(),
        );
    }
    spawn_process_waiter(
        window.clone(),
        state.inner().processes.clone(),
        shared,
        id.clone(),
        event_family,
        metadata,
    );
    Ok(json!({ "id": id, "success": true }))
}

fn spawn_process_reader<R: std::io::Read + Send + 'static>(
    window: Window,
    id: String,
    reader: R,
    stream: &'static str,
    event_family: &str,
    port: Arc<Mutex<Option<u16>>>,
    metadata: Value,
) {
    let event_family = event_family.to_string();
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(read) = reader.read_line(&mut line) else {
                break;
            };
            if read == 0 {
                break;
            }
            let detected_port = detect_port(&line);
            if let Some(detected) = detected_port {
                if let Ok(mut guard) = port.lock() {
                    *guard = Some(detected);
                }
            }
            let current_port = port.lock().ok().and_then(|guard| *guard);
            let payload = if event_family == "ssh" {
                json!({
                    "id": id,
                    "taskId": id,
                    "data": general_purpose::STANDARD.encode(line.as_bytes()),
                    "stream": stream,
                    "port": current_port,
                    "metadata": metadata
                })
            } else {
                json!({
                    "id": id,
                    "data": line,
                    "chunk": line,
                    "stream": stream,
                    "port": current_port,
                    "metadata": metadata
                })
            };
            let _ = emit_command_event(&window, &format!("{event_family}:output"), payload);
        }
    });
}

fn spawn_process_waiter(
    window: Window,
    processes: Arc<Mutex<BTreeMap<String, ManagedProcess>>>,
    child: Arc<SharedChild>,
    id: String,
    event_family: &str,
    metadata: Value,
) {
    let event_family = event_family.to_string();
    thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        let _ = emit_command_event(
            &window,
            &format!("{event_family}:output"),
            json!({
                "id": id,
                "data": format!("\n[Process exited with code {code}]\n"),
                "exited": true,
                "exitCode": code,
                "metadata": metadata
            }),
        );
        if event_family == "terminal" {
            let _ = emit_command_event(
                &window,
                "terminal:exit",
                json!({ "id": id, "exitCode": code }),
            );
        }
        let _ = processes.lock().map(|mut guard| guard.remove(&id));
    });
}

pub(crate) fn process_kill(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<IdArg>(args)?;
    let process = state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&input.id);
    let Some(process) = process else {
        return Ok(json!({ "success": false, "error": "Process not found" }));
    };
    process.child.kill().map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub(crate) fn process_write(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<ProcessWriteArgs>(args)?;
    let processes = state.processes.lock().map_err(|error| error.to_string())?;
    let Some(process) = processes.get(&input.id) else {
        return Ok(json!({ "success": false, "error": "Process not found" }));
    };
    let mut stdin = process.stdin.lock().map_err(|error| error.to_string())?;
    let Some(stdin) = stdin.as_mut() else {
        return Ok(json!({ "success": false, "error": "Process stdin is closed" }));
    };
    stdin
        .write_all(input.input.as_bytes())
        .map_err(|error| error.to_string())?;
    if input.append_newline.unwrap_or(false) {
        stdin.write_all(b"\n").map_err(|error| error.to_string())?;
    }
    Ok(json!({ "success": true }))
}

pub(crate) fn process_status(
    state: &tauri::State<'_, AppState>,
    args: &[Value],
) -> Result<Value, String> {
    let input = parse_first_arg::<IdArg>(args)?;
    let processes = state.processes.lock().map_err(|error| error.to_string())?;
    Ok(json!({
        "success": true,
        "running": processes.contains_key(&input.id)
    }))
}

pub(crate) fn process_list(state: &tauri::State<'_, AppState>) -> Result<Value, String> {
    let processes = state.processes.lock().map_err(|error| error.to_string())?;
    Ok(Value::Array(
        processes
            .iter()
            .map(|(id, process)| {
                json!({
                    "id": id,
                    "pid": process.child.id(),
                    "command": process.command,
                    "cwd": process.cwd,
                    "createdAt": process.created_at,
                    "port": process.port.lock().ok().and_then(|guard| *guard),
                    "metadata": process.metadata
                })
            })
            .collect(),
    ))
}

fn detect_port(line: &str) -> Option<u16> {
    for marker in ["localhost:", "127.0.0.1:", "0.0.0.0:"] {
        if let Some(index) = line.find(marker) {
            let start = index + marker.len();
            let digits = line[start..]
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>();
            if let Ok(port) = digits.parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}
