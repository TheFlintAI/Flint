use serde_json::{json, Value};

// ── Search result types ──────────────────────────────────────────────

pub(crate) struct GrepMatch {
    pub(crate) path: String,
    pub(crate) line: Option<usize>,
    pub(crate) column: Option<usize>,
    pub(crate) text: String,
    pub(crate) kind: &'static str,
    pub(crate) count: Option<usize>,
}

pub(crate) struct GrepResult {
    pub(crate) matches: Vec<GrepMatch>,
    pub(crate) meta: SearchMeta,
}

pub(crate) struct SearchMeta {
    pub(crate) search_root: String,
    pub(crate) pattern: String,
    pub(crate) output_mode: String,
    pub(crate) truncated: bool,
    pub(crate) limit_reason: Option<String>,
    pub(crate) search_time_ms: u128,
    pub(crate) warnings: Vec<String>,
    pub(crate) files_skipped: u32,
}

impl SearchMeta {
    pub(crate) fn new(search_root: String, pattern: String, output_mode: String) -> Self {
        Self {
            search_root,
            pattern,
            output_mode,
            truncated: false,
            limit_reason: None,
            search_time_ms: 0,
            warnings: Vec::new(),
            files_skipped: 0,
        }
    }
}

impl GrepResult {
    pub(crate) fn to_json(self) -> Value {
        json!({
            "kind": "grep",
            "matches": self.matches.iter().map(|m| m.to_json()).collect::<Vec<_>>(),
            "meta": {
                "backend": "local",
                "searchRoot": self.meta.search_root,
                "pathStyle": "relative_to_search_root",
                "truncated": self.meta.truncated,
                "timedOut": false,
                "limitReason": self.meta.limit_reason,
                "pattern": self.meta.pattern,
                "outputMode": self.meta.output_mode,
                "searchTime": self.meta.search_time_ms,
                "warnings": self.meta.warnings,
                "filesSkipped": self.meta.files_skipped,
            }
        })
    }
}

impl GrepMatch {
    pub(crate) fn to_json(&self) -> Value {
        let mut j = json!({
            "path": self.path,
            "kind": self.kind,
        });
        if let Some(line) = self.line {
            j["line"] = json!(line);
        }
        if let Some(column) = self.column {
            j["column"] = json!(column);
        }
        if !self.text.is_empty() {
            j["text"] = json!(self.text);
        }
        if let Some(count) = self.count {
            j["count"] = json!(count);
        }
        j
    }
}

// ── Display helpers ──────────────────────────────────────────────────

/// Compute display path: relative to search root, forward slashes.
pub(crate) fn display_path(path: &std::path::Path, root: &std::path::Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Truncate line text to `max_len` chars, appending "..." if truncated.
pub(crate) fn truncate_line(text: &str, max_len: usize) -> String {
    if text.chars().count() <= max_len {
        text.to_string()
    } else {
        format!("{}...", text.chars().take(max_len.saturating_sub(3)).collect::<String>())
    }
}
