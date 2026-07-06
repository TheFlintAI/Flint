use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, RgbaImage};

use super::utils::started_millis;
use crate::http_client::build_http_client;
use crate::utils::{flint_path, home_dir};

pub(crate) fn persist_generated_image(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing image args".to_string())?;
    let data = input
        .get("data")
        .or_else(|| input.get("base64"))
        .and_then(Value::as_str)
        .ok_or_else(|| "image data is required".to_string())?;
    let name = input
        .get("name")
        .or_else(|| input.get("defaultName"))
        .and_then(Value::as_str)
        .unwrap_or("generated-image.png");
    let path = flint_path("images").join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = general_purpose::STANDARD
        .decode(data.split(',').next_back().unwrap_or(data))
        .map_err(|error| error.to_string())?;
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(json!({ "success": true, "path": path.to_string_lossy().to_string() }))
}

pub(crate) fn image_fetch_base64(args: &[Value]) -> Result<Value, String> {
    let url = args
        .first()
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .ok_or_else(|| "url is required".to_string())?;
    let response = build_http_client(false)?
        .get(url)
        .send()
        .map_err(|error| error.to_string())?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response.bytes().map_err(|error| error.to_string())?;
    Ok(json!({
        "success": true,
        "data": general_purpose::STANDARD.encode(bytes),
        "mimeType": content_type
    }))
}

pub(crate) fn image_download(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing image download args".to_string())?;
    let url = input
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "url is required".to_string())?;
    let default_name = input
        .get("defaultName")
        .or_else(|| input.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("image");
    let response = build_http_client(false)?
        .get(url)
        .send()
        .map_err(|error| error.to_string())?;
    let bytes = response.bytes().map_err(|error| error.to_string())?;
    let path = home_dir()
        .join("downloads")
        .join(default_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(json!({ "success": true, "path": path.to_string_lossy().to_string() }))
}

pub(crate) fn clipboard_write_image(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing clipboard args".to_string())?;
    let data = input
        .get("data")
        .or_else(|| input.get("base64"))
        .and_then(Value::as_str)
        .ok_or_else(|| "image data is required".to_string())?;
    let bytes = decode_base64_image(data)?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("Failed to decode image for clipboard: {error}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let clipboard_image = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::Owned(image.into_raw()),
    };
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set_image(clipboard_image)
        .map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub(crate) fn clipboard_read_text() -> Result<Value, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let text = clipboard.get_text().map_err(|error| error.to_string())?;
    Ok(json!({ "success": true, "text": text }))
}

pub(crate) fn clipboard_write_text(args: &[Value]) -> Result<Value, String> {
    let input = args
        .first()
        .ok_or_else(|| "missing clipboard args".to_string())?;
    let text = input
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "text is required".to_string())?;
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    clipboard.set_text(text).map_err(|error| error.to_string())?;
    Ok(json!({ "success": true }))
}

pub(crate) fn clipboard_read_image() -> Result<Value, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let image_data = clipboard.get_image().map_err(|error| error.to_string())?;
    // arboard::ImageData has width, height, bytes (RGBA)
    let rgba = image::RgbaImage::from_raw(
        image_data.width as u32,
        image_data.height as u32,
        image_data.bytes.to_vec(),
    )
    .ok_or_else(|| "Failed to create image from clipboard data".to_string())?;
    let dynamic = image::DynamicImage::ImageRgba8(rgba);
    let mut png_bytes = Vec::new();
    dynamic
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "success": true,
        "data": general_purpose::STANDARD.encode(png_bytes),
        "width": image_data.width,
        "height": image_data.height
    }))
}

pub(crate) fn create_gif_from_grid(args: &[Value]) -> Result<Value, String> {
    let input = args.first().ok_or_else(|| "missing GIF args".to_string())?;
    let source_bytes = load_image_source_bytes(input)?;
    let decoded = image::load_from_memory(&source_bytes)
        .map_err(|error| format!("Failed to decode generated image: {error}"))?;
    let (source_width, source_height) = decoded.dimensions();
    if source_width == 0 || source_height == 0 {
        return Ok(json!({ "success": false, "error": "Generated image is empty." }));
    }
    if source_width != source_height {
        return Ok(json!({
            "success": false,
            "error": "Generated image must be square before slicing into a 3x3 grid."
        }));
    }

    let grid = decoded.resize_exact(768, 768, image::imageops::FilterType::Lanczos3);
    let output_dir = gif_output_dir(input)?;
    let grid_path = output_dir.join("grid.png");
    let grid_png = encode_png(&grid)?;
    fs::write(&grid_path, &grid_png).map_err(|error| error.to_string())?;

    let mut persisted_frames = Vec::new();
    let mut gif_frames = Vec::new();
    let cell_size = 256u32;
    for row in 0..3 {
        for col in 0..3 {
            let frame = grid.crop_imm(col * cell_size, row * cell_size, cell_size, cell_size);
            let frame_path = output_dir.join(format!("frame-{:02}.png", row * 3 + col + 1));
            let frame_png = encode_png(&frame)?;
            fs::write(&frame_path, &frame_png).map_err(|error| error.to_string())?;
            persisted_frames.push(persisted_image_result(&frame_path, &frame_png, "image/png"));
            gif_frames.push(frame.to_rgba8());
        }
    }

    let delay_ms = input
        .get("frameDurationMs")
        .and_then(Value::as_u64)
        .unwrap_or(120)
        .max(20);
    let gif_bytes = encode_gif_rgba(&gif_frames, delay_ms)?;
    let gif_path = output_dir.join("animation.gif");
    fs::write(&gif_path, &gif_bytes).map_err(|error| error.to_string())?;

    Ok(json!({
        "success": true,
        "grid": persisted_image_result(&grid_path, &grid_png, "image/png"),
        "frames": persisted_frames,
        "gif": persisted_image_result(&gif_path, &gif_bytes, "image/gif"),
        "outputDir": output_dir.to_string_lossy().to_string(),
        "gridSize": 768,
        "frameSize": 256
    }))
}

fn load_image_source_bytes(input: &Value) -> Result<Vec<u8>, String> {
    if let Some(path) = input.get("filePath").and_then(Value::as_str) {
        if !path.trim().is_empty() {
            return fs::read(path).map_err(|error| error.to_string());
        }
    }
    let data = input
        .get("data")
        .or_else(|| input.get("base64"))
        .and_then(Value::as_str)
        .ok_or_else(|| "Missing source image file path or base64 data.".to_string())?;
    decode_base64_image(data)
}

fn decode_base64_image(data: &str) -> Result<Vec<u8>, String> {
    let payload = data.split(',').next_back().unwrap_or(data);
    general_purpose::STANDARD
        .decode(payload)
        .map_err(|error| error.to_string())
}

fn gif_output_dir(input: &Value) -> Result<PathBuf, String> {
    let run_id = input
        .get("runId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("run");
    let safe_run_id = run_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let dir = flint_path("image")
        .join(format!("gif-grid-{}-{safe_run_id}", started_millis()));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(cursor.into_inner())
}

fn encode_gif_rgba(frames: &[RgbaImage], delay_ms: u64) -> Result<Vec<u8>, String> {
    let first = frames
        .first()
        .ok_or_else(|| "At least one GIF frame is required.".to_string())?;
    let (width, height) = first.dimensions();
    let mut output = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut output, width as u16, height as u16, &[])
            .map_err(|error| error.to_string())?;
        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(|error| error.to_string())?;
        for frame_image in frames {
            if frame_image.dimensions() != (width, height) {
                return Err("All GIF frames must share the same dimensions.".to_string());
            }
            let mut rgba = frame_image.clone().into_raw();
            let mut frame = gif::Frame::from_rgba_speed(width as u16, height as u16, &mut rgba, 10);
            frame.delay = (delay_ms / 10).max(1) as u16;
            encoder
                .write_frame(&frame)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(output)
}

fn persisted_image_result(path: &Path, bytes: &[u8], media_type: &str) -> Value {
    json!({
        "filePath": path.to_string_lossy().to_string(),
        "mediaType": media_type,
        "data": general_purpose::STANDARD.encode(bytes)
    })
}
