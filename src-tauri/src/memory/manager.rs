use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use super::search::{self, LocalEmbedding};
use super::storage::{self, MemoryStore};
use super::types::*;

// ── Manager ────────────────────────────────────────────────────────

pub(crate) struct MemorySystem {
    store: MemoryStore,
    embedding: Mutex<LocalEmbedding>,
}

impl MemorySystem {
    /// Initialize the memory system.
    ///
    /// `db_path` — path to the SQLite database file (e.g. `~/.flint/memory.db`).
    /// `model_dir` — directory containing the local embedding model files.
    ///
    /// Panics if the model files cannot be loaded.
    pub(crate) fn new(db_path: &Path, model_dir: &Path) -> Self {
        let store = MemoryStore::new(db_path)
            .expect("Failed to initialize memory store");
        let embedding = LocalEmbedding::new(model_dir)
            .expect("Failed to load embedding model from local files");

        tracing::info!(
            "Memory system initialized: db={}, model={}, dim={}",
            store.storage_path(),
            model_dir.display(),
            embedding.dim(),
        );

        Self {
            store,
            embedding: Mutex::new(embedding),
        }
    }

    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        self.embedding
            .lock()
            .map_err(|e| format!("lock: {e}"))?
            .embed(texts)
    }

    fn vector_dim(&self) -> usize {
        self.embedding.lock().map(|e| e.dim()).unwrap_or(768)
    }

    // ── List ───────────────────────────────────────────────────────

    pub(crate) fn list(&self, p: MemoryListParams) -> Result<MemoryIndexSnapshot, String> {
        let entries = self.store.list(&p)?;
        let total = self.store.count(None)?;

        Ok(MemoryIndexSnapshot {
            entries: entries
                .into_iter()
                .map(|e| MemoryIndexEntry {
                    id: e.id,
                    entry_type: e.entry_type,
                    summary: e.summary,
                    updated_at: e.updated_at,
                })
                .collect(),
            total_entries: total,
            updated_at: storage::now_ms(),
        })
    }

    // ── Read ───────────────────────────────────────────────────────

    pub(crate) fn read(&self, id: &str) -> Result<MemoryEntry, String> {
        self.store
            .get(id)?
            .ok_or_else(|| format!("Memory entry \"{}\" not found", id))
    }

    // ── Search ─────────────────────────────────────────────────────

    pub(crate) fn search(
        &self,
        p: MemorySearchParams,
    ) -> Result<Vec<MemorySearchResult>, String> {
        let lim = p.limit.unwrap_or(20).min(100);

        // Resolve query vector: use provided vector, or embed query text
        let query_vec: Vec<f32> = if let Some(ref v) = p.vector {
            v.clone()
        } else if let Some(ref q) = p.query {
            match self.embed(&[q.clone()]) {
                Ok(mut vecs) => vecs.pop().unwrap_or_default(),
                Err(e) => return Err(e),
            }
        } else {
            return Err("Search requires either 'query' or 'vector'".into());
        };

        let type_filter = p.entry_type.as_deref();

        let candidates = self.store.get_all_with_vectors()?;
        let results = search::vector_search(
            &query_vec,
            &candidates,
            lim,
            type_filter,
        );

        Ok(results
            .into_iter()
            .map(|(entry, score)| {
                let ml = if let Some(ref q) = p.query {
                    search::matched_lines(&entry.body, q, 10)
                } else {
                    vec![]
                };
                MemorySearchResult {
                    entry,
                    score,
                    matched_lines: ml,
                }
            })
            .collect())
    }

    // ── Write ──────────────────────────────────────────────────────

    pub(crate) fn write(&self, p: MemoryWriteParams) -> Result<MemoryEntry, String> {
        let body = p.body.trim().to_string();
        if body.is_empty() {
            return Err("body required".into());
        }

        let now = storage::now_iso();
        let summary = storage::extract_summary(&body);

        // Determine vector: use provided vector, or embed locally
        let vector: Option<Vec<f32>> = if let Some(ref v) = p.vector {
            Some(v.clone())
        } else {
            match self.embed(&[body.clone()]) {
                Ok(mut vecs) => vecs.pop(),
                Err(e) => return Err(e),
            }
        };

        // Branch: update existing entry vs create new one
        if let Some(ref existing_id) = p.id {
            // ── UPDATE path ──────────────────────────────────────────
            let existing = self
                .store
                .get(existing_id)?
                .ok_or_else(|| format!("Memory entry \"{}\" not found for update", existing_id))?;

            let entry = merge_entry(existing, &p, body, summary, now);
            self.store.update(&entry, vector.as_deref())?;
            Ok(entry)
        } else {
            // ── CREATE path ──────────────────────────────────────────
            let et = p
                .entry_type
                .as_deref()
                .and_then(storage::normalize_type)
                .unwrap_or_else(|| "context".into());

            let counter = self.store.next_counter()?;
            let id = storage::gen_id(&et, counter);

            let entry = MemoryEntry {
                id,
                entry_type: et,
                body,
                summary,
                created_at: now.clone(),
                updated_at: now,
            };

            self.store.insert(&entry, vector.as_deref())?;
            Ok(entry)
        }
    }

    // ── Delete ─────────────────────────────────────────────────────

    pub(crate) fn delete(&self, id: &str) -> Result<MemoryDeleteResult, String> {
        self.store.delete(id)?;
        Ok(MemoryDeleteResult {
            success: true,
            id: id.into(),
        })
    }

    // ── Stats ──────────────────────────────────────────────────────

    pub(crate) fn stats(&self) -> Result<MemoryStats, String> {
        let total = self.store.count(None)?;
        let mut by_type = HashMap::new();

        for ty in &["preference", "decision", "context", "reference"] {
            if let Ok(c) = self.store.count(Some(ty)) {
                if c > 0 {
                    by_type.insert(ty.to_string(), c);
                }
            }
        }

        Ok(MemoryStats {
            total_entries: total,
            by_type,
            vector_dim: self.vector_dim(),
            storage_path: self.store.storage_path().to_string(),
        })
    }

    // ── Rebuild ────────────────────────────────────────────────────

    pub(crate) fn rebuild(&self) -> Result<MemoryStats, String> {
        let entries = self.store.get_all()?;
        let texts: Vec<String> = entries.iter().map(|e| e.body.clone()).collect();

        let vectors = self.embed(&texts)?;
        if vectors.len() != entries.len() {
            return Err("Embedding count mismatch".into());
        }

        for (entry, vector) in entries.iter().zip(vectors.iter()) {
            self.store.update(entry, Some(vector.as_slice()))?;
        }

        self.stats()
    }
}

// ── Merge helper (pure function, testable) ────────────────────────

/// Build a merged entry for an update: use provided values where given,
/// preserve existing values for everything else. `created_at` is immutable.
fn merge_entry(
    existing: MemoryEntry,
    p: &MemoryWriteParams,
    body: String,
    summary: String,
    now: String,
) -> MemoryEntry {
    MemoryEntry {
        id: existing.id,
        entry_type: p
            .entry_type
            .as_deref()
            .and_then(storage::normalize_type)
            .unwrap_or(existing.entry_type),
        body,
        summary,
        created_at: existing.created_at,
        updated_at: now,
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> MemoryEntry {
        MemoryEntry {
            id: "pre_20240601_001".into(),
            entry_type: "preference".into(),
            body: "Original body".into(),
            summary: "Original body".into(),
            created_at: "2024-06-01T00:00:00Z".into(),
            updated_at: "2024-06-01T00:00:00Z".into(),
        }
    }

    fn params_without_optionals(id: &str, body: &str) -> MemoryWriteParams {
        MemoryWriteParams {
            id: Some(id.into()),
            entry_type: None,
            body: body.into(),
            vector: None,
        }
    }

    #[test]
    fn test_merge_preserves_type_when_not_provided() {
        let existing = sample_entry();
        let params = params_without_optionals("pre_20240601_001", "New body");
        let merged = merge_entry(existing, &params, "New body".into(), "New body".into(), "2024-06-02T00:00:00Z".into());
        assert_eq!(merged.entry_type, "preference");
    }

    #[test]
    fn test_merge_preserves_created_at() {
        let existing = sample_entry();
        let params = params_without_optionals("pre_20240601_001", "New body");
        let merged = merge_entry(existing, &params, "New body".into(), "New body".into(), "2024-06-02T00:00:00Z".into());
        assert_eq!(merged.created_at, "2024-06-01T00:00:00Z");
    }

    #[test]
    fn test_merge_overrides_provided_fields() {
        let existing = sample_entry();
        let params = MemoryWriteParams {
            id: Some("pre_20240601_001".into()),
            entry_type: Some("decision".into()),
            body: "New body".into(),
            vector: None,
        };
        let merged = merge_entry(existing, &params, "New body".into(), "New body".into(), "2024-06-02T00:00:00Z".into());
        assert_eq!(merged.entry_type, "decision");
        assert_eq!(merged.body, "New body");
        assert_eq!(merged.summary, "New body");
        assert_eq!(merged.updated_at, "2024-06-02T00:00:00Z");
        assert_eq!(merged.created_at, "2024-06-01T00:00:00Z");
    }

    #[test]
    fn test_merge_invalid_type_preserves_existing() {
        let existing = sample_entry();
        let params = MemoryWriteParams {
            id: Some("pre_20240601_001".into()),
            entry_type: Some("garbage".into()),
            body: "New body".into(),
            vector: None,
        };
        let merged = merge_entry(existing, &params, "New body".into(), "New body".into(), "2024-06-02T00:00:00Z".into());
        assert_eq!(merged.entry_type, "preference");
    }
}
