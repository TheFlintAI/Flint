use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

use super::types::*;

const VALID_TYPES: &[&str] = &["preference", "decision", "context", "reference"];

// ── Helpers ─────────────────────────────────────────────────────────

pub(crate) fn now_iso() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = (s / 86400) as i64;
    let (y, mo, d) = days_to_date(days);
    let t = s % 86400;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        mo,
        d,
        t / 3600,
        (t % 3600) / 60,
        t % 60
    )
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn days_to_date(days: i64) -> (i64, usize, i64) {
    let mut y = 1970i64;
    let mut r = days;
    loop {
        let yd = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
            366
        } else {
            365
        };
        if r < yd {
            break;
        }
        r -= yd;
        y += 1;
    }
    let md: [i64; 12] = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0;
    while m < 12 && r >= md[m] {
        r -= md[m];
        m += 1;
    }
    (y, m + 1, r + 1)
}

fn type_prefix(t: &str) -> &str {
    match t {
        "preference" => "pre",
        "decision" => "dec",
        "context" => "ctx",
        "reference" => "ref",
        _ => &t[..3.min(t.len())],
    }
}

pub(crate) fn extract_summary(body: &str) -> String {
    for line in body.trim().lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let s = t.strip_prefix('#').unwrap_or(t).trim();
        return if s.len() <= 100 {
            s.into()
        } else {
            format!("{}...", &s[..97])
        };
    }
    "(empty)".into()
}

pub(crate) fn normalize_type(raw: &str) -> Option<String> {
    let t = raw.trim().to_lowercase();
    VALID_TYPES.contains(&t.as_str()).then_some(t)
}

fn serialize_vector(vec: &[f32]) -> Vec<u8> {
    vec.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn deserialize_vector(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        return None;
    }
    let len = bytes.len() / 4;
    let mut vec = Vec::with_capacity(len);
    for i in 0..len {
        let start = i * 4;
        let arr: [u8; 4] = bytes[start..start + 4].try_into().unwrap();
        vec.push(f32::from_le_bytes(arr));
    }
    Some(vec)
}

// ── Storage ─────────────────────────────────────────────────────────

pub(crate) struct MemoryStore {
    conn: Mutex<Connection>,
    path: String,
}

impl MemoryStore {
    pub(crate) fn new(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create storage dir: {e}"))?;
        }
        let conn = Connection::open(db_path).map_err(|e| format!("open db: {e}"))?;

        // Performance pragmas
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-8000;",
        )
        .map_err(|e| format!("pragma: {e}"))?;

        let store = Self {
            conn: Mutex::new(conn),
            path: db_path.to_string_lossy().to_string(),
        };
        store.init()?;
        Ok(store)
    }

    fn init(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                entry_type TEXT NOT NULL,
                body TEXT NOT NULL,
                summary TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                vector BLOB,
                vector_dim INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(entry_type);",
        )
        .map_err(|e| format!("init schema: {e}"))?;
        Ok(())
    }

    // ── CRUD ───────────────────────────────────────────────────────

    pub(crate) fn insert(
        &self,
        entry: &MemoryEntry,
        vector: Option<&[f32]>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (vec_blob, vec_dim) = match vector {
            Some(v) => (Some(serialize_vector(v)), Some(v.len() as i64)),
            None => (None, None),
        };
        conn.execute(
            "INSERT INTO memories (id, entry_type, body, summary, created_at, updated_at,
             vector, vector_dim)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id,
                entry.entry_type,
                entry.body,
                entry.summary,
                entry.created_at,
                entry.updated_at,
                vec_blob,
                vec_dim,
            ],
        )
        .map_err(|e| format!("insert: {e}"))?;
        Ok(())
    }

    pub(crate) fn update(
        &self,
        entry: &MemoryEntry,
        vector: Option<&[f32]>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (vec_blob, vec_dim) = match vector {
            Some(v) => (Some(serialize_vector(v)), Some(v.len() as i64)),
            None => (None, None),
        };
        conn.execute(
            "UPDATE memories SET entry_type=?2, body=?3, summary=?4, created_at=?5,
             updated_at=?6, vector=?7, vector_dim=?8 WHERE id=?1",
            params![
                entry.id,
                entry.entry_type,
                entry.body,
                entry.summary,
                entry.created_at,
                entry.updated_at,
                vec_blob,
                vec_dim,
            ],
        )
        .map_err(|e| format!("update: {e}"))?;
        Ok(())
    }

    pub(crate) fn delete(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
            .map_err(|e| format!("delete: {e}"))?;
        Ok(())
    }

    pub(crate) fn get(&self, id: &str) -> Result<Option<MemoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, entry_type, body, summary, created_at, updated_at
                 FROM memories WHERE id = ?1",
            )
            .map_err(|e| format!("prepare: {e}"))?;
        let mut rows = stmt
            .query_map(params![id], |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    entry_type: row.get(1)?,
                    body: row.get(2)?,
                    summary: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("query: {e}"))?;
        match rows.next() {
            Some(Ok(entry)) => Ok(Some(entry)),
            Some(Err(e)) => Err(format!("row: {e}")),
            None => Ok(None),
        }
    }

    pub(crate) fn list(&self, params: &MemoryListParams) -> Result<Vec<MemoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut sql = String::from(
            "SELECT id, entry_type, body, summary, created_at, updated_at FROM memories WHERE 1=1",
        );
        let mut bind_values: Vec<String> = Vec::new();

        if let Some(ref t) = params.entry_type {
            bind_values.push(t.clone());
            sql.push_str(&format!(" AND entry_type = ?{}", bind_values.len()));
        }

        sql.push_str(" ORDER BY updated_at DESC");

        if let Some(limit) = params.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }
        if let Some(offset) = params.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = bind_values
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    entry_type: row.get(1)?,
                    body: row.get(2)?,
                    summary: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("query: {e}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("row: {e}"))?);
        }
        Ok(entries)
    }

    pub(crate) fn count(&self, type_filter: Option<&str>) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut sql = String::from("SELECT COUNT(*) FROM memories WHERE 1=1");
        let mut bind_values: Vec<String> = Vec::new();

        if let Some(t) = type_filter {
            bind_values.push(t.to_string());
            sql.push_str(&format!(" AND entry_type = ?{}", bind_values.len()));
        }

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = bind_values
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();

        let count: usize = stmt
            .query_row(param_refs.as_slice(), |row| row.get(0))
            .map_err(|e| format!("count: {e}"))?;
        Ok(count)
    }

    /// Fetch all entries with their vectors for search.
    /// Returns entries that have vectors (vector IS NOT NULL).
    pub(crate) fn get_all_with_vectors(&self) -> Result<Vec<VectorEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, entry_type, body, summary, created_at, updated_at, vector
                 FROM memories WHERE vector IS NOT NULL",
            )
            .map_err(|e| format!("prepare: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let entry = MemoryEntry {
                    id: row.get(0)?,
                    entry_type: row.get(1)?,
                    body: row.get(2)?,
                    summary: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                };
                let vector_blob: Option<Vec<u8>> = row.get(6)?;
                Ok(VectorEntry {
                    entry,
                    vector: vector_blob.and_then(|b| deserialize_vector(&b)),
                })
            })
            .map_err(|e| format!("query: {e}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("row: {e}"))?);
        }
        Ok(entries)
    }

    /// Fetch all entries without vectors (for text-only operations).
    pub(crate) fn get_all(&self) -> Result<Vec<MemoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, entry_type, body, summary, created_at, updated_at
                 FROM memories ORDER BY updated_at DESC",
            )
            .map_err(|e| format!("prepare: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(MemoryEntry {
                    id: row.get(0)?,
                    entry_type: row.get(1)?,
                    body: row.get(2)?,
                    summary: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("query: {e}"))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("row: {e}"))?);
        }
        Ok(entries)
    }

    pub(crate) fn next_counter(&self) -> Result<u32, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: u32 = conn
            .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
            .map_err(|e| format!("count: {e}"))?;
        Ok(count + 1)
    }

    pub(crate) fn storage_path(&self) -> &str {
        &self.path
    }
}

// ── Gen ID ─────────────────────────────────────────────────────────

pub(crate) fn gen_id(entry_type: &str, counter: u32) -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = (s / 86400) as i64;
    let (y, mo, d) = days_to_date(days);
    format!(
        "{}_{:04}{:02}{:02}_{:03}",
        type_prefix(entry_type),
        y,
        mo,
        d,
        counter
    )
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_store() -> MemoryStore {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        MemoryStore::new(&db_path).unwrap()
    }

    fn make_entry(id: &str, ty: &str, body: &str, created_at: &str) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            entry_type: ty.to_string(),
            body: body.to_string(),
            summary: extract_summary(body),
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
        }
    }

    #[test]
    fn test_insert_and_get() {
        let store = make_store();
        let entry = make_entry(
            "ctx_20240601_001",
            "context",
            "# Test body\nSome content",
            "2024-06-01T00:00:00Z",
        );
        store.insert(&entry, None).unwrap();

        let fetched = store.get("ctx_20240601_001").unwrap().unwrap();
        assert_eq!(fetched.id, entry.id);
        assert_eq!(fetched.entry_type, "context");
        assert_eq!(fetched.body, "# Test body\nSome content");
        assert_eq!(fetched.summary, "Test body");
        assert_eq!(fetched.created_at, "2024-06-01T00:00:00Z");
    }

    #[test]
    fn test_get_nonexistent() {
        let store = make_store();
        let result = store.get("nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_preserves_type_and_created_at() {
        let store = make_store();
        let original = make_entry(
            "pre_20240601_001",
            "preference",
            "# Original body\nSome content",
            "2024-06-01T00:00:00Z",
        );
        store.insert(&original, None).unwrap();

        let mut updated = original.clone();
        updated.body = "# Updated body".to_string();
        updated.summary = extract_summary(&updated.body);
        updated.updated_at = now_iso();

        store.update(&updated, None).unwrap();
        let fetched = store.get("pre_20240601_001").unwrap().unwrap();

        assert_eq!(fetched.body, "# Updated body");
        assert_eq!(fetched.summary, "Updated body");
        assert_eq!(fetched.entry_type, "preference");
        assert_eq!(fetched.created_at, "2024-06-01T00:00:00Z");
        assert_ne!(fetched.updated_at, original.updated_at);
    }

    #[test]
    fn test_update_overrides_provided_fields() {
        let store = make_store();
        let original = make_entry(
            "dec_20240601_001",
            "decision",
            "# Original",
            "2024-06-01T00:00:00Z",
        );
        store.insert(&original, None).unwrap();

        let mut updated = original.clone();
        updated.entry_type = "context".to_string();
        updated.body = "# Completely changed".to_string();
        updated.summary = extract_summary(&updated.body);
        updated.updated_at = now_iso();

        store.update(&updated, None).unwrap();
        let fetched = store.get("dec_20240601_001").unwrap().unwrap();

        assert_eq!(fetched.entry_type, "context");
        assert_eq!(fetched.body, "# Completely changed");
        assert_eq!(fetched.created_at, "2024-06-01T00:00:00Z");
    }

    #[test]
    fn test_created_at_immutable_on_update() {
        let store = make_store();
        let original = make_entry(
            "ref_20240601_001",
            "reference",
            "# Original",
            "2024-01-15T12:30:00Z",
        );
        store.insert(&original, None).unwrap();

        for i in 1..=3 {
            let mut updated = original.clone();
            updated.body = format!("# Update {}", i);
            updated.summary = extract_summary(&updated.body);
            updated.updated_at = now_iso();
            store.update(&updated, None).unwrap();
        }

        let fetched = store.get("ref_20240601_001").unwrap().unwrap();
        assert_eq!(fetched.created_at, "2024-01-15T12:30:00Z");
        assert_eq!(fetched.body, "# Update 3");
    }

    #[test]
    fn test_delete() {
        let store = make_store();
        let entry = make_entry("ctx_001", "context", "# Body", "2024-06-01T00:00:00Z");
        store.insert(&entry, None).unwrap();
        assert!(store.get("ctx_001").unwrap().is_some());

        store.delete("ctx_001").unwrap();
        assert!(store.get("ctx_001").unwrap().is_none());
    }

    #[test]
    fn test_delete_nonexistent_is_noop() {
        let store = make_store();
        let result = store.delete("nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_all() {
        let store = make_store();
        store.insert(&make_entry("ctx_001", "context", "# A", "2024-06-01T00:00:00Z"), None).unwrap();
        store.insert(&make_entry("pre_001", "preference", "# B", "2024-06-02T00:00:00Z"), None).unwrap();
        store.insert(&make_entry("dec_001", "decision", "# C", "2024-06-03T00:00:00Z"), None).unwrap();

        let params = MemoryListParams {
            entry_type: None,
            limit: None,
            offset: None,
        };
        let entries = store.list(&params).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].id, "dec_001");
        assert_eq!(entries[1].id, "pre_001");
        assert_eq!(entries[2].id, "ctx_001");
    }

    #[test]
    fn test_list_filter_by_type() {
        let store = make_store();
        store.insert(&make_entry("ctx_001", "context", "# A", "2024-06-01T00:00:00Z"), None).unwrap();
        store.insert(&make_entry("pre_001", "preference", "# B", "2024-06-02T00:00:00Z"), None).unwrap();
        store.insert(&make_entry("ctx_002", "context", "# C", "2024-06-03T00:00:00Z"), None).unwrap();

        let params = MemoryListParams {
            entry_type: Some("context".to_string()),
            limit: None,
            offset: None,
        };
        let entries = store.list(&params).unwrap();
        assert_eq!(entries.len(), 2);
        for e in &entries {
            assert_eq!(e.entry_type, "context");
        }
    }

    #[test]
    fn test_list_limit_and_offset() {
        let store = make_store();
        for i in 0..5 {
            store.insert(
                &make_entry(&format!("ctx_{:03}", i), "context", &format!("# {}", i), "2024-06-01T00:00:00Z"),
                None,
            ).unwrap();
        }

        let params = MemoryListParams {
            entry_type: None,
            limit: Some(2),
            offset: Some(1),
        };
        let entries = store.list(&params).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn test_count() {
        let store = make_store();
        store.insert(&make_entry("ctx_001", "context", "# A", "2024-06-01T00:00:00Z"), None).unwrap();
        store.insert(&make_entry("pre_001", "preference", "# B", "2024-06-02T00:00:00Z"), None).unwrap();

        assert_eq!(store.count(None).unwrap(), 2);
        assert_eq!(store.count(Some("context")).unwrap(), 1);
        assert_eq!(store.count(Some("preference")).unwrap(), 1);
        assert_eq!(store.count(Some("decision")).unwrap(), 0);
    }

    #[test]
    fn test_next_counter_starts_at_one() {
        let store = make_store();
        assert_eq!(store.next_counter().unwrap(), 1);

        store.insert(&make_entry("ctx_001", "context", "# A", "2024-06-01T00:00:00Z"), None).unwrap();
        assert_eq!(store.next_counter().unwrap(), 2);
    }

    #[test]
    fn test_gen_id_format() {
        let id = gen_id("preference", 5);
        assert!(id.starts_with("pre_"));
        assert!(id.contains("_005"));
    }
}
