// Cosine similarity search engine and local embedding backend.

use std::path::Path;

use super::types::*;

// ── Cosine Similarity ───────────────────────────────────────────────

/// Compute cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

// ── Search Engine ───────────────────────────────────────────────────

/// Vector search over stored entries. Returns top-k results with cosine similarity scores.
pub(crate) fn vector_search(
    query_vec: &[f32],
    candidates: &[VectorEntry],
    top_k: usize,
    type_filter: Option<&str>,
) -> Vec<(MemoryEntry, f64)> {
    let mut scored: Vec<(usize, f64)> = candidates
        .iter()
        .enumerate()
        .filter_map(|(i, ve)| {
            if let Some(t) = type_filter {
                if ve.entry.entry_type != t {
                    return None;
                }
            }
            let vec = ve.vector.as_ref()?;
            let sim = cosine_similarity(query_vec, vec);
            Some((i, sim as f64))
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    scored
        .into_iter()
        .map(|(i, score)| (candidates[i].entry.clone(), score))
        .collect()
}

/// Find matching lines in entry body for a text query.
pub(crate) fn matched_lines(body: &str, query: &str, max: usize) -> Vec<MatchedLine> {
    let ql = query.to_lowercase();
    body.lines()
        .enumerate()
        .filter(|(_, l)| l.to_lowercase().contains(&ql))
        .map(|(i, l)| MatchedLine {
            line: (i + 1) as u32,
            text: l.to_string(),
        })
        .take(max)
        .collect()
}

// ── Local Embedding ─────────────────────────────────────────────────

use fastembed::{
    Pooling, QuantizationMode, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel,
};

/// Local embedding backend using fastembed with pre-downloaded ONNX model files.
/// Model: google/embeddinggemma-300m (768-dim, mean pooling, Q4 quantized).
pub(crate) struct LocalEmbedding {
    inner: TextEmbedding,
    dim: usize,
}

impl LocalEmbedding {
    /// Load the embedding model from a local directory.
    ///
    /// The directory must contain:
    ///   - `onnx/model.onnx`
    ///   - `tokenizer.json`
    ///   - `config.json`
    ///   - `special_tokens_map.json`
    ///   - `tokenizer_config.json`
    pub(crate) fn new(model_dir: &Path) -> Result<Self, String> {
        let onnx_path = model_dir.join("onnx").join("model.onnx");
        let onnx_file = std::fs::read(&onnx_path)
            .map_err(|e| format!("Failed to read {}: {e}", onnx_path.display()))?;

        let read_json = |name: &str| -> Result<Vec<u8>, String> {
            let path = model_dir.join(name);
            std::fs::read(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))
        };

        let tokenizer_files = TokenizerFiles {
            tokenizer_file: read_json("tokenizer.json")?,
            config_file: read_json("config.json")?,
            special_tokens_map_file: read_json("special_tokens_map.json")?,
            tokenizer_config_file: read_json("tokenizer_config.json")?,
        };

        let model = UserDefinedEmbeddingModel::new(onnx_file, tokenizer_files)
            .with_pooling(Pooling::Mean)
            .with_quantization(QuantizationMode::None);

        let inner = TextEmbedding::try_new_from_user_defined(
            model,
            fastembed::InitOptionsUserDefined::default(),
        )
        .map_err(|e| format!("Failed to initialize embedding model: {e}"))?;

        Ok(Self { inner, dim: 768 })
    }

    pub(crate) fn embed(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        self.inner
            .embed(&refs, None)
            .map_err(|e| format!("Embedding failed: {e}"))
    }

    pub(crate) fn dim(&self) -> usize {
        self.dim
    }
}
