use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Entry ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub body: String,
    pub summary: String,
    pub created_at: String,
    pub updated_at: String,
}

// ── Index Snapshot ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryIndexEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub summary: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryIndexSnapshot {
    pub entries: Vec<MemoryIndexEntry>,
    pub total_entries: usize,
    pub updated_at: u64,
}

// ── Params ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryListParams {
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemorySearchParams {
    /// Text query — embedded locally if no vector provided.
    pub query: Option<String>,
    /// Pre-computed query vector (from provider API). Takes precedence over query.
    pub vector: Option<Vec<f32>>,
    pub limit: Option<usize>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryWriteParams {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: Option<String>,
    pub body: String,
    /// Pre-computed embedding vector for the body.
    /// If not provided, the local embedding backend generates one.
    pub vector: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IdParam {
    pub id: String,
}

// ── Results ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedLine {
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchResult {
    pub entry: MemoryEntry,
    pub score: f64,
    pub matched_lines: Vec<MatchedLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_entries: usize,
    pub by_type: HashMap<String, usize>,
    pub vector_dim: usize,
    pub storage_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryDeleteResult {
    pub success: bool,
    pub id: String,
}

// ── Internal entry with optional vector ────────────────────────────

/// A memory entry paired with its deserialized vector for search.
#[derive(Debug, Clone)]
pub(crate) struct VectorEntry {
    pub entry: MemoryEntry,
    pub vector: Option<Vec<f32>>,
}
