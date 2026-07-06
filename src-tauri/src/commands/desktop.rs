use base64::{engine::general_purpose, Engine as _};
use image::GenericImageView;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::process::Command;

use super::utils::started_millis;

pub(crate) fn desktop_screenshot_capture() -> Result<Value, String> {
    if env::consts::OS != "windows" {
        return desktop_screenshot_capture_portable();
    }
    let output_path = env::temp_dir().join(format!("flint-screenshot-{}.png", started_millis()));
    let output_string = output_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('{output_string}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "$($bounds.Width),$($bounds.Height),$([System.Windows.Forms.Screen]::AllScreens.Count)"
"#
    );
    let output = powershell_script(&script)?;
    if !output.status.success() {
        return Ok(json!({
            "success": false,
            "error": String::from_utf8_lossy(&output.stderr).trim().to_string()
        }));
    }
    let bytes = fs::read(&output_path).map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&output_path);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts = stdout.trim().split(',').collect::<Vec<_>>();
    Ok(json!({
        "success": true,
        "data": general_purpose::STANDARD.encode(bytes),
        "width": parts.first().and_then(|value| value.parse::<u32>().ok()),
        "height": parts.get(1).and_then(|value| value.parse::<u32>().ok()),
        "originX": 0,
        "originY": 0,
        "displayCount": parts.get(2).and_then(|value| value.parse::<u32>().ok()).unwrap_or(1),
        "mediaType": "image/png"
    }))
}

pub(crate) fn desktop_input_click(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing desktop click args".to_string())?;
    let x = input
        .get("x")
        .and_then(Value::as_f64)
        .ok_or_else(|| "x is required".to_string())?
        .round() as i32;
    let y = input
        .get("y")
        .and_then(Value::as_f64)
        .ok_or_else(|| "y is required".to_string())?
        .round() as i32;
    let button = input
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left");
    let action = input
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("click");
    if env::consts::OS != "windows" {
        return desktop_input_click_portable(x, y, button, action);
    }
    let (down_flag, up_flag) = match button {
        "right" => (0x0008, 0x0010),
        "middle" => (0x0020, 0x0040),
        _ => (0x0002, 0x0004),
    };
    let body = match action {
        "down" => format!("[NativeInput]::MouseEvent({down_flag}, 0, 0, 0, [UIntPtr]::Zero)"),
        "up" => format!("[NativeInput]::MouseEvent({up_flag}, 0, 0, 0, [UIntPtr]::Zero)"),
        "double_click" => format!(
            "[NativeInput]::MouseEvent({down_flag}, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::MouseEvent({up_flag}, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [NativeInput]::MouseEvent({down_flag}, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::MouseEvent({up_flag}, 0, 0, 0, [UIntPtr]::Zero)"
        ),
        _ => format!(
            "[NativeInput]::MouseEvent({down_flag}, 0, 0, 0, [UIntPtr]::Zero); [NativeInput]::MouseEvent({up_flag}, 0, 0, 0, [UIntPtr]::Zero)"
        ),
    };
    let script = format!(
        r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeInput {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  public static void MouseEvent(uint flags, uint dx, uint dy, int data, UIntPtr extra) {{ mouse_event(flags, dx, dy, data, extra); }}
}}
"@
[NativeInput]::SetCursorPos({x}, {y}) | Out-Null
{body}
"#
    );
    run_desktop_powershell(&script)?;
    Ok(json!({ "success": true, "x": x, "y": y, "button": button, "action": action }))
}

pub(crate) fn desktop_input_type(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing desktop type args".to_string())?;
    if env::consts::OS != "windows" {
        return desktop_input_type_portable(input);
    }
    if let Some(text) = input.get("text").and_then(Value::as_str) {
        let escaped = text.replace('\'', "''");
        let script = format!(
            r#"
Add-Type -AssemblyName System.Windows.Forms
Set-Clipboard -Value '{escaped}'
[System.Windows.Forms.SendKeys]::SendWait('^v')
"#
        );
        run_desktop_powershell(&script)?;
        return Ok(json!({ "success": true, "mode": "text", "textLength": text.chars().count() }));
    }
    if let Some(key) = input.get("key").and_then(Value::as_str) {
        let send_key = send_keys_token(key)?;
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('{send_key}')"
        );
        run_desktop_powershell(&script)?;
        return Ok(json!({ "success": true, "mode": "key", "key": key }));
    }
    if let Some(hotkey) = input.get("hotkey").and_then(Value::as_array) {
        let keys = hotkey
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        if keys.len() < 2 {
            return Ok(
                json!({ "success": false, "error": "Desktop input requires text, key, or hotkey." }),
            );
        }
        let chord = send_keys_chord(&keys)?;
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('{chord}')"
        );
        run_desktop_powershell(&script)?;
        return Ok(json!({ "success": true, "mode": "hotkey", "hotkey": keys }));
    }
    Ok(json!({ "success": false, "error": "Desktop input requires text, key, or hotkey." }))
}

pub(crate) fn desktop_input_scroll(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing desktop scroll args".to_string())?;
    let x = input
        .get("x")
        .and_then(Value::as_f64)
        .map(|value| value.round() as i32);
    let y = input
        .get("y")
        .and_then(Value::as_f64)
        .map(|value| value.round() as i32);
    let scroll_x = input
        .get("scrollX")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .round() as i32;
    let scroll_y = input
        .get("scrollY")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .round() as i32;
    if env::consts::OS != "windows" {
        return desktop_input_scroll_portable(x, y, scroll_x, scroll_y);
    }
    let move_mouse = match (x, y) {
        (Some(x), Some(y)) => format!("[NativeInput]::SetCursorPos({x}, {y}) | Out-Null"),
        _ => String::new(),
    };
    let wheel_y = scroll_y.saturating_mul(120);
    let wheel_x = scroll_x.saturating_mul(120);
    let script = format!(
        r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeInput {{
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  public static void MouseEvent(uint flags, uint dx, uint dy, int data, UIntPtr extra) {{ mouse_event(flags, dx, dy, data, extra); }}
}}
"@
{move_mouse}
if ({wheel_y} -ne 0) {{ [NativeInput]::MouseEvent(0x0800, 0, 0, {wheel_y}, [UIntPtr]::Zero) }}
if ({wheel_x} -ne 0) {{ [NativeInput]::MouseEvent(0x1000, 0, 0, {wheel_x}, [UIntPtr]::Zero) }}
"#
    );
    run_desktop_powershell(&script)?;
    Ok(json!({ "success": true, "x": x, "y": y, "scrollX": scroll_x, "scrollY": scroll_y }))
}

fn run_desktop_powershell(script: &str) -> Result<(), String> {
    let output = powershell_script(script)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn powershell_script(script: &str) -> Result<std::process::Output, String> {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| error.to_string())
}

fn desktop_screenshot_capture_portable() -> Result<Value, String> {
    let output_path = env::temp_dir().join(format!("flint-screenshot-{}.png", started_millis()));
    let output_string = output_path.to_string_lossy().to_string();
    let attempts: Vec<(&str, Vec<String>)> = match env::consts::OS {
        "macos" => vec![(
            "screencapture",
            vec!["-x".to_string(), output_string.clone()],
        )],
        "linux" => vec![
            (
                "gnome-screenshot",
                vec!["-f".to_string(), output_string.clone()],
            ),
            ("grim", vec![output_string.clone()]),
            (
                "spectacle",
                vec![
                    "-b".to_string(),
                    "-n".to_string(),
                    "-o".to_string(),
                    output_string.clone(),
                ],
            ),
            ("scrot", vec![output_string.clone()]),
        ],
        other => {
            return Ok(json!({
                "success": false,
                "error": format!("Desktop capture is unavailable on {other}.")
            }));
        }
    };

    let mut errors = Vec::new();
    for (program, args) in attempts {
        match Command::new(program).args(&args).output() {
            Ok(output) if output.status.success() && output_path.exists() => {
                let bytes = fs::read(&output_path).map_err(|error| error.to_string())?;
                let _ = fs::remove_file(&output_path);
                let dimensions = image::load_from_memory(&bytes)
                    .map(|image| image.dimensions())
                    .unwrap_or((0, 0));
                return Ok(json!({
                    "success": true,
                    "data": general_purpose::STANDARD.encode(bytes),
                    "width": dimensions.0,
                    "height": dimensions.1,
                    "originX": 0,
                    "originY": 0,
                    "displayCount": 1,
                    "mediaType": "image/png"
                }));
            }
            Ok(output) => {
                errors.push(format!(
                    "{program}: {}{}",
                    String::from_utf8_lossy(&output.stderr).trim(),
                    String::from_utf8_lossy(&output.stdout).trim()
                ));
            }
            Err(error) => errors.push(format!("{program}: {error}")),
        }
    }
    let _ = fs::remove_file(&output_path);
    Ok(json!({
        "success": false,
        "error": format!("Desktop capture failed. Tried platform tools: {}", errors.join("; "))
    }))
}

fn desktop_input_click_portable(
    x: i32,
    y: i32,
    button: &str,
    action: &str,
) -> Result<Value, String> {
    match env::consts::OS {
        "macos" => run_macos_mouse_action(x, y, button, action)?,
        "linux" => run_linux_mouse_action(x, y, button, action)?,
        other => {
            return Ok(json!({
                "success": false,
                "error": format!("Desktop input is unavailable on {other}.")
            }));
        }
    }
    Ok(json!({ "success": true, "x": x, "y": y, "button": button, "action": action }))
}

fn desktop_input_type_portable(input: &Value) -> Result<Value, String> {
    if let Some(text) = input.get("text").and_then(Value::as_str) {
        match env::consts::OS {
            "macos" => run_osascript(&[format!(
                "tell application \"System Events\" to keystroke \"{}\"",
                applescript_escape(text)
            )])?,
            "linux" => run_checked_command("xdotool", &["type", "--", text])?,
            other => {
                return Ok(json!({
                    "success": false,
                    "error": format!("Desktop input is unavailable on {other}.")
                }));
            }
        }
        return Ok(json!({ "success": true, "mode": "text", "textLength": text.chars().count() }));
    }
    if let Some(key) = input.get("key").and_then(Value::as_str) {
        match env::consts::OS {
            "macos" => run_macos_key_action(&[key.to_string()])?,
            "linux" => run_checked_command("xdotool", &["key", &linux_key_name(key)])?,
            other => {
                return Ok(json!({
                    "success": false,
                    "error": format!("Desktop input is unavailable on {other}.")
                }));
            }
        }
        return Ok(json!({ "success": true, "mode": "key", "key": key }));
    }
    if let Some(hotkey) = input.get("hotkey").and_then(Value::as_array) {
        let keys = hotkey
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        if keys.len() < 2 {
            return Ok(
                json!({ "success": false, "error": "Desktop input requires text, key, or hotkey." }),
            );
        }
        match env::consts::OS {
            "macos" => run_macos_key_action(&keys)?,
            "linux" => run_checked_command("xdotool", &["key", &linux_hotkey_name(&keys)])?,
            other => {
                return Ok(json!({
                    "success": false,
                    "error": format!("Desktop input is unavailable on {other}.")
                }));
            }
        }
        return Ok(json!({ "success": true, "mode": "hotkey", "hotkey": keys }));
    }
    Ok(json!({ "success": false, "error": "Desktop input requires text, key, or hotkey." }))
}

fn desktop_input_scroll_portable(
    x: Option<i32>,
    y: Option<i32>,
    scroll_x: i32,
    scroll_y: i32,
) -> Result<Value, String> {
    match env::consts::OS {
        "macos" => {
            if let (Some(x), Some(y)) = (x, y) {
                run_macos_mouse_action(x, y, "left", "move")?;
            }
            let script = format!(
                r#"import CoreGraphics
let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32({}), wheel2: Int32({}), wheel3: 0)
event?.post(tap: .cghidEventTap)"#,
                -scroll_y, scroll_x
            );
            run_checked_command("swift", &["-e", &script])?;
        }
        "linux" => {
            if let (Some(x), Some(y)) = (x, y) {
                run_checked_command("xdotool", &["mousemove", &x.to_string(), &y.to_string()])?;
            }
            run_linux_scroll(scroll_x, scroll_y)?;
        }
        other => {
            return Ok(json!({
                "success": false,
                "error": format!("Desktop input is unavailable on {other}.")
            }));
        }
    }
    Ok(json!({ "success": true, "x": x, "y": y, "scrollX": scroll_x, "scrollY": scroll_y }))
}

fn run_checked_command(program: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} failed to start: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn run_osascript(commands: &[String]) -> Result<(), String> {
    let mut args = Vec::new();
    for command in commands {
        args.push("-e");
        args.push(command.as_str());
    }
    run_checked_command("osascript", &args)
}

fn applescript_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn run_macos_mouse_action(x: i32, y: i32, button: &str, action: &str) -> Result<(), String> {
    let mouse_button = match button {
        "right" => ".right",
        "middle" => ".center",
        _ => ".left",
    };
    let (down, up) = match button {
        "right" => (".rightMouseDown", ".rightMouseUp"),
        _ => (".leftMouseDown", ".leftMouseUp"),
    };
    if action == "move" {
        let script = format!(
            r#"import CoreGraphics
CGWarpMouseCursorPosition(CGPoint(x: {x}, y: {y}))"#
        );
        return run_checked_command("swift", &["-e", &script]);
    }
    let body = match action {
        "down" => format!("post({down})"),
        "up" => format!("post({up})"),
        "double_click" => {
            format!("post({down}); post({up}); usleep(60000); post({down}); post({up})")
        }
        _ => format!("post({down}); post({up})"),
    };
    let script = format!(
        r#"import CoreGraphics
import Glibc
let point = CGPoint(x: {x}, y: {y})
func post(_ type: CGEventType) {{
  let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: {mouse_button})
  event?.post(tap: .cghidEventTap)
}}
CGWarpMouseCursorPosition(point)
{body}"#
    );
    run_checked_command("swift", &["-e", &script]).or_else(|_| {
        if matches!(action, "click" | "double_click") {
            let click = format!("tell application \"System Events\" to click at {{{x}, {y}}}");
            if action == "double_click" {
                run_osascript(&[click.clone(), click])
            } else {
                run_osascript(&[click])
            }
        } else {
            Err("macOS down/up mouse actions require Swift/CoreGraphics.".to_string())
        }
    })
}

fn run_linux_mouse_action(x: i32, y: i32, button: &str, action: &str) -> Result<(), String> {
    let button_number = match button {
        "right" => "3",
        "middle" => "2",
        _ => "1",
    };
    run_checked_command("xdotool", &["mousemove", &x.to_string(), &y.to_string()])?;
    match action {
        "down" => run_checked_command("xdotool", &["mousedown", button_number]),
        "up" => run_checked_command("xdotool", &["mouseup", button_number]),
        "double_click" => {
            run_checked_command("xdotool", &["click", button_number])?;
            run_checked_command("xdotool", &["click", button_number])
        }
        _ => run_checked_command("xdotool", &["click", button_number]),
    }
}

fn run_linux_scroll(scroll_x: i32, scroll_y: i32) -> Result<(), String> {
    let (vertical_button, vertical_count) = if scroll_y < 0 {
        ("4", scroll_y.saturating_abs())
    } else {
        ("5", scroll_y)
    };
    let (horizontal_button, horizontal_count) = if scroll_x < 0 {
        ("6", scroll_x.saturating_abs())
    } else {
        ("7", scroll_x)
    };
    for _ in 0..vertical_count.min(50) {
        run_checked_command("xdotool", &["click", vertical_button])?;
    }
    for _ in 0..horizontal_count.min(50) {
        run_checked_command("xdotool", &["click", horizontal_button])?;
    }
    Ok(())
}

fn run_macos_key_action(keys: &[String]) -> Result<(), String> {
    let (modifiers, key) = keys.split_at(keys.len().saturating_sub(1));
    let key = key
        .first()
        .ok_or_else(|| "Desktop input requires a key.".to_string())?;
    let modifier_names = modifiers
        .iter()
        .filter_map(|modifier| match modifier.as_str() {
            "Control" | "Ctrl" => Some("control down"),
            "Shift" => Some("shift down"),
            "Alt" | "Option" => Some("option down"),
            "Meta" | "Command" | "Cmd" => Some("command down"),
            _ => None,
        })
        .collect::<Vec<_>>();
    let using_clause = if modifier_names.is_empty() {
        String::new()
    } else {
        format!(" using {{{}}}", modifier_names.join(", "))
    };
    if let Some(key_code) = macos_key_code(key) {
        run_osascript(&[format!(
            "tell application \"System Events\" to key code {key_code}{using_clause}"
        )])
    } else {
        run_osascript(&[format!(
            "tell application \"System Events\" to keystroke \"{}\"{}",
            applescript_escape(&macos_keystroke_name(key)),
            using_clause
        )])
    }
}

fn macos_key_code(key: &str) -> Option<u16> {
    match key {
        "Enter" => Some(36),
        "Tab" => Some(48),
        "Escape" => Some(53),
        "Backspace" => Some(51),
        "Delete" => Some(117),
        "ArrowLeft" => Some(123),
        "ArrowRight" => Some(124),
        "ArrowDown" => Some(125),
        "ArrowUp" => Some(126),
        "Home" => Some(115),
        "End" => Some(119),
        "PageUp" => Some(116),
        "PageDown" => Some(121),
        "Space" => Some(49),
        _ => None,
    }
}

fn macos_keystroke_name(key: &str) -> String {
    match key {
        "Control" | "Ctrl" | "Shift" | "Alt" | "Option" | "Meta" | "Command" | "Cmd" => {
            String::new()
        }
        value if value.len() == 1 => value.to_lowercase(),
        value => value.to_string(),
    }
}

fn linux_key_name(key: &str) -> String {
    match key {
        "Enter" => "Return".to_string(),
        "Escape" => "Escape".to_string(),
        "Backspace" => "BackSpace".to_string(),
        "ArrowUp" => "Up".to_string(),
        "ArrowDown" => "Down".to_string(),
        "ArrowLeft" => "Left".to_string(),
        "ArrowRight" => "Right".to_string(),
        "Meta" => "Super_L".to_string(),
        value => value.to_string(),
    }
}

fn linux_hotkey_name(keys: &[String]) -> String {
    keys.iter()
        .map(|key| match key.as_str() {
            "Control" | "Ctrl" => "ctrl".to_string(),
            "Shift" => "shift".to_string(),
            "Alt" | "Option" => "alt".to_string(),
            "Meta" | "Command" | "Cmd" => "super".to_string(),
            value => linux_key_name(value),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn send_keys_token(key: &str) -> Result<String, String> {
    let token = match key {
        "Enter" => "{ENTER}".to_string(),
        "Tab" => "{TAB}".to_string(),
        "Escape" => "{ESC}".to_string(),
        "Backspace" => "{BACKSPACE}".to_string(),
        "Delete" => "{DELETE}".to_string(),
        "ArrowUp" => "{UP}".to_string(),
        "ArrowDown" => "{DOWN}".to_string(),
        "ArrowLeft" => "{LEFT}".to_string(),
        "ArrowRight" => "{RIGHT}".to_string(),
        "Home" => "{HOME}".to_string(),
        "End" => "{END}".to_string(),
        "PageUp" => "{PGUP}".to_string(),
        "PageDown" => "{PGDN}".to_string(),
        "Space" => " ".to_string(),
        key if key.len() == 1 => key.to_string(),
        key if key.starts_with('F') => format!("{{{key}}}"),
        _ => return Err(format!("Unsupported key: {key}.")),
    };
    Ok(token)
}

fn send_keys_chord(keys: &[String]) -> Result<String, String> {
    let mut prefix = String::new();
    for modifier in &keys[..keys.len() - 1] {
        prefix.push_str(match modifier.as_str() {
            "Control" => "^",
            "Alt" => "%",
            "Shift" => "+",
            "Meta" => "^",
            other => return Err(format!("Unsupported hotkey modifier: {other}.")),
        });
    }
    Ok(format!(
        "{}{}",
        prefix,
        send_keys_token(&keys[keys.len() - 1])?
    ))
}
