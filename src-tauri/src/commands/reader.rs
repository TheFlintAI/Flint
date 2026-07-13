use serde_json::{json, Value};
use std::path::Path;

const MAX_OUTPUT_BYTES: usize = 64 * 1024;

// ── Format detection ──────────────────────────────────────────────

pub(crate) enum DocumentFormat {
    Pdf,
    Office,
    Spreadsheet,
}

impl DocumentFormat {
    fn label(&self) -> &'static str {
        match self {
            Self::Pdf => "PDF",
            Self::Office => "Office",
            Self::Spreadsheet => "Spreadsheet",
        }
    }
}

/// Detect supported binary document format by file extension.
pub(crate) fn detect_document_format(path: &str) -> Option<DocumentFormat> {
    match Path::new(path)
        .extension()?
        .to_str()?
        .to_lowercase()
        .as_str()
    {
        "pdf" => Some(DocumentFormat::Pdf),
        "docx" | "doc" | "pptx" | "ppt" => Some(DocumentFormat::Office),
        "xlsx" | "xls" => Some(DocumentFormat::Spreadsheet),
        _ => None,
    }
}

// ── Public entry points ───────────────────────────────────────────

/// Read any text or document file. Binary document formats (PDF, DOCX, XLSX,
/// PPTX) are routed to the document extractor; plain text files are decoded
/// with automatic encoding detection.
pub(crate) fn read_file(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    pages: Option<&str>,
) -> Result<Value, String> {
    // Binary document formats — dispatch to document reader
    if detect_document_format(path).is_some() {
        return read_document(path, pages);
    }

    let bytes = std::fs::read(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => format!("File not found: {path}"),
        _ => error.to_string(),
    })?;

    let content = decode_text(&bytes, path)?;

    if offset.is_none() && limit.is_none() {
        return Ok(json!({ "content": content, "path": path }));
    }

    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let total = lines.len();
    let start = offset.unwrap_or(1).saturating_sub(1).min(total);
    let end = match limit {
        Some(limit) => start.saturating_add(limit).min(total),
        None => total,
    };
    let sliced: String = lines[start..end].concat();
    let truncated = end < total;
    Ok(json!({ "content": sliced, "path": path, "truncated": truncated, "totalLines": total }))
}

// ── Text decoding ─────────────────────────────────────────────────

/// Decode raw bytes into a Rust string, trying UTF-8 first then falling back
/// to chardetng auto-detection for CJK and other legacy encodings.
fn decode_text(bytes: &[u8], path: &str) -> Result<String, String> {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }

    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _used, had_errors) = encoding.decode(bytes);
    if had_errors {
        return Err(format!(
            "Cannot decode file as text: {path}. If this is a binary file, \
             supported formats are PDF, DOCX, XLSX, PPTX"
        ));
    }
    Ok(decoded.into_owned())
}

// ── Document reader ───────────────────────────────────────────────

fn read_document(path: &str, pages: Option<&str>) -> Result<Value, String> {
    if !Path::new(path).exists() {
        return Ok(json!({ "notFound": true, "path": path }));
    }

    let format = detect_document_format(path)
        .ok_or_else(|| format!("Unsupported file format: {path}"))?;

    let label = format.label();
    let (content, total_pages) = match format {
        DocumentFormat::Pdf => extract_pdf(path, pages)?,
        DocumentFormat::Office => (extract_office(path)?, None),
        DocumentFormat::Spreadsheet => (extract_spreadsheet(path)?, None),
    };

    let (content, truncated, total_lines) = truncate_output(&content);

    let mut result = json!({
        "content": content,
        "path": path,
        "format": label.to_lowercase(),
        "truncated": truncated,
    });
    if let Some(pages) = total_pages {
        result["totalPages"] = json!(pages);
    }
    if let Some(lines) = total_lines {
        result["totalLines"] = json!(lines);
    }
    Ok(result)
}

// ── PDF extraction ────────────────────────────────────────────────

fn extract_pdf(path: &str, pages: Option<&str>) -> Result<(String, Option<usize>), String> {
    let doc = unpdf::parse_file(path).map_err(|e| format!("Failed to read PDF: {e}"))?;
    let total = doc.page_count() as usize;

    let text = match pages {
        Some(spec) => {
            let indices = parse_page_spec(spec, total)?;
            indices
                .into_iter()
                .filter_map(|i| doc.get_page(i as u32 + 1).map(|p| p.plain_text()))
                .collect::<Vec<_>>()
                .join("\n\n")
        }
        None => doc.plain_text(),
    };

    Ok((text, Some(total)))
}

/// Parse a page specification like "1-5", "1,3,7", or "1-3,5,7-9".
/// Pages are 1-indexed in the spec, converted to 0-indexed.
fn parse_page_spec(spec: &str, total: usize) -> Result<Vec<usize>, String> {
    let mut indices = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start, end)) = part.split_once('-') {
            let start: usize = start
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page spec: {spec}"))?;
            let end: usize = end
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page spec: {spec}"))?;
            if start == 0 || end < start {
                return Err(format!("Invalid page range: {part}"));
            }
            for p in start..=end.min(total) {
                indices.push(p - 1);
            }
        } else {
            let p: usize = part
                .parse()
                .map_err(|_| format!("Invalid page spec: {spec}"))?;
            if p == 0 || p > total {
                return Err(format!("Page {p} out of range (1-{total})"));
            }
            indices.push(p - 1);
        }
    }
    indices.sort_unstable();
    indices.dedup();
    Ok(indices)
}

// ── Office document extraction (DOCX, PPTX, DOC, PPT) ─────────────

fn extract_office(path: &str) -> Result<String, String> {
    let doc = office_oxide::Document::open(path)
        .map_err(|e| format!("Failed to read document: {e}"))?;
    Ok(doc.plain_text())
}

// ── Spreadsheet extraction (XLSX, XLS) ────────────────────────────

fn extract_spreadsheet(path: &str) -> Result<String, String> {
    let doc = office_oxide::Document::open(path)
        .map_err(|e| format!("Failed to read spreadsheet: {e}"))?;
    Ok(doc.to_markdown())
}

// ── Output truncation ─────────────────────────────────────────────

fn truncate_output(content: &str) -> (String, bool, Option<usize>) {
    let total_lines = content.lines().count();
    if content.len() <= MAX_OUTPUT_BYTES {
        return (content.to_string(), false, Some(total_lines));
    }

    let truncated: String = content.chars().take(MAX_OUTPUT_BYTES).collect();
    let truncated_lines = truncated.lines().count();
    (truncated, true, Some(truncated_lines))
}
