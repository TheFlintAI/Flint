//! Plugin lifecycle manager.
//!
//! Owns discovery (resource dir + user dir), enable/disable state machine,
//! settings persistence. All I/O is synchronous Rust filesystem.
//!
//! The frontend calls into this via `plugin:*` Tauri command channels.

use crate::plugin::flp;
use crate::plugin::types::*;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub struct PluginManager {
    plugins: std::sync::Mutex<BTreeMap<String, PluginInfo>>,
    state_path: PathBuf,
    resource_dir: std::sync::Mutex<PathBuf>,
    user_dir: std::sync::Mutex<PathBuf>,
}

impl PluginManager {
    pub fn new(state_path: PathBuf) -> Self {
        Self {
            plugins: std::sync::Mutex::new(BTreeMap::new()),
            state_path,
            resource_dir: std::sync::Mutex::new(PathBuf::new()),
            user_dir: std::sync::Mutex::new(PathBuf::new()),
        }
    }

    // ─── Discovery ───

    /// Discover plugins from resource and user plugin directories.
    pub fn discover(&self, resource_dir: &Path, user_dir: &Path) -> Vec<PluginInfo> {
        *self.resource_dir.lock().unwrap() = resource_dir.to_path_buf();
        *self.user_dir.lock().unwrap() = user_dir.to_path_buf();

        let mut discovered = Vec::new();
        self.discover_dir(resource_dir, &mut discovered);
        self.discover_dir(user_dir, &mut discovered);

        self.load_state();
        self.list_all()
    }

    fn discover_dir(&self, dir: &Path, discovered: &mut Vec<PluginInfo>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|ext| ext == "flp").unwrap_or(false) {
                if let Some(info) = self.ingest_flp(&path) {
                    discovered.push(info);
                }
            }
        }
    }

    /// Import a `.flp` archive into the user plugin directory.
    pub fn import_flp(&self, src: &Path, user_dir: &Path) -> Result<PluginInfo, String> {
        *self.user_dir.lock().unwrap() = user_dir.to_path_buf();
        fs::create_dir_all(user_dir).map_err(|e| format!("create plugin dir: {e}"))?;

        let data = fs::read(src).map_err(|e| format!("read flp: {e}"))?;
        let entries = flp::parse_flp(&data).map_err(|e| format!("FLP parse error: {e}"))?;
        if !flp::verify_checksum(&entries).unwrap_or(false) {
            return Err("Plugin integrity check failed".into());
        }

        let manifest_toml = flp::extract_manifest(&entries)
            .map_err(|e| format!("manifest error: {e}"))?;
        let manifest = parse_manifest_toml(&manifest_toml)
            .map_err(|e| format!("manifest parse error: {e}"))?;
        let id = manifest.name.clone();

        let dest = user_dir.join(format!("{id}.flp"));
        fs::write(&dest, &data).map_err(|e| format!("write flp: {e}"))?;

        let info = self
            .ingest_flp(&dest)
            .ok_or_else(|| "failed to ingest flp".to_string())?;
        self.save_state();
        Ok(info)
    }

    fn ingest_flp(&self, path: &Path) -> Option<PluginInfo> {
        let data = fs::read(path).ok()?;
        let entries = flp::parse_flp(&data).ok()?;

        if flp::verify_checksum(&entries).unwrap_or(false) == false {
            tracing::error!("[PluginManager] Checksum failed for {:?}", path);
            return None;
        }

        let manifest_toml = flp::extract_manifest(&entries).ok()?;
        let manifest = parse_manifest_toml(&manifest_toml).ok()?;

        let id = manifest.name.clone();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut plugins = self.plugins.lock().unwrap();

        if let Some(existing) = plugins.get_mut(&id) {
            existing.manifest = manifest;
            existing.size = data.len() as u64;
            Some(existing.clone())
        } else {
            let info = PluginInfo {
                id: id.clone(),
                manifest,
                status: PluginStatus::Installed,
                enabled: false,
                size: data.len() as u64,
                installed_at: now,
                enabled_at: None,
                settings: json!({}),
                state: json!({}),
                error_message: None,
            };
            plugins.insert(id.clone(), info.clone());
            Some(info)
        }
    }

    // ─── Lifecycle ───

    /// Enable a plugin (persistent state only).
    pub fn enable(&self, id: &str) -> Result<Value, String> {
        let flp_data = self.read_plugin_flp(id)?;
        let entries = flp::parse_flp(&flp_data).map_err(|e| format!("FLP parse error: {e}"))?;

        if !flp::verify_checksum(&entries).unwrap_or(false) {
            return Err("Plugin integrity check failed".into());
        }

        let manifest_toml = flp::extract_manifest(&entries)?;
        let manifest = manifest_toml_to_json(&manifest_toml)
            .map_err(|e| format!("manifest parse error: {e}"))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        {
            let mut plugins = self.plugins.lock().unwrap();
            if let Some(info) = plugins.get_mut(id) {
                info.status = PluginStatus::Enabled;
                info.enabled = true;
                info.enabled_at = Some(now);
                info.error_message = None;
            } else {
                return Err(format!("Plugin '{}' not found", id));
            }
        }

        self.save_state();
        Ok(manifest)
    }

    /// Get the plugin's JavaScript source for Web Worker creation.
    /// Decompresses from .flp (FLP2 gzip or FLP1 raw).
    pub fn get_source(&self, id: &str) -> Result<String, String> {
        let flp_data = self.read_plugin_flp(id)?;
        let entries = flp::parse_flp(&flp_data).map_err(|e| format!("FLP parse error: {e}"))?;
        if !flp::verify_checksum(&entries).unwrap_or(false) {
            return Err("Plugin integrity check failed".into());
        }
        flp::extract_plugin_js(&entries)
    }

    /// Read the shared plugin runtime from the resource directory.
    /// Returns the runtime JavaScript source.
    pub fn get_runtime(&self) -> Result<String, String> {
        let resource_dir = self.resource_dir.lock().unwrap();
        let runtime_path = resource_dir.join("runtime.js");
        fs::read_to_string(&runtime_path)
            .map_err(|e| format!("Failed to read runtime.js from {}: {e}", runtime_path.display()))
    }

    pub fn disable(&self, id: &str) -> Result<(), String> {
        {
            let mut plugins = self.plugins.lock().unwrap();
            if let Some(info) = plugins.get_mut(id) {
                info.status = PluginStatus::Disabled;
                info.enabled = false;
                info.error_message = None;
            }
        }
        self.save_state();
        Ok(())
    }

    // ─── Settings ───

    pub fn set_setting(&self, id: &str, key: &str, value: Value) -> Result<(), String> {
        {
            let mut plugins = self.plugins.lock().unwrap();
            let info = plugins
                .get_mut(id)
                .ok_or_else(|| format!("Plugin '{}' not found", id))?;
            info.settings[key] = value;
        }
        self.save_state();
        Ok(())
    }

    // ─── State (per-plugin persistent key-value store) ───

    pub fn get_state(&self, id: &str) -> Result<Value, String> {
        let plugins = self.plugins.lock().unwrap();
        let info = plugins
            .get(id)
            .ok_or_else(|| format!("Plugin '{}' not found", id))?;
        Ok(info.state.clone())
    }

    pub fn set_state(&self, id: &str, key: &str, value: Value) -> Result<(), String> {
        {
            let mut plugins = self.plugins.lock().unwrap();
            let info = plugins
                .get_mut(id)
                .ok_or_else(|| format!("Plugin '{}' not found", id))?;
            if info.state.is_null() || !info.state.is_object() {
                info.state = json!({});
            }
            info.state[key] = value;
        }
        self.save_state();
        Ok(())
    }

    pub fn delete_state(&self, id: &str, key: &str) -> Result<(), String> {
        {
            let mut plugins = self.plugins.lock().unwrap();
            let info = plugins
                .get_mut(id)
                .ok_or_else(|| format!("Plugin '{}' not found", id))?;
            if info.state.is_object() {
                if let Some(obj) = info.state.as_object_mut() {
                    obj.remove(key);
                }
            }
        }
        self.save_state();
        Ok(())
    }

    pub fn uninstall(&self, id: &str, user_dir: &Path) -> Result<(), String> {
        let flp_path = user_dir.join(format!("{id}.flp"));
        if flp_path.exists() {
            fs::remove_file(&flp_path).map_err(|e| format!("remove plugin file: {e}"))?;
        }
        let dir_path = user_dir.join(id);
        if dir_path.exists() && dir_path.is_dir() {
            fs::remove_dir_all(&dir_path).map_err(|e| format!("remove plugin dir: {e}"))?;
        }
        {
            let mut plugins = self.plugins.lock().unwrap();
            plugins.remove(id);
        }
        self.save_state();
        Ok(())
    }

    // ─── Queries ───

    pub fn list_all(&self) -> Vec<PluginInfo> {
        let plugins = self.plugins.lock().unwrap();
        let result: Vec<PluginInfo> = plugins.values().cloned().collect();
        let enabled = result.iter().filter(|p| p.enabled).count();
        tracing::debug!("[PluginManager] list_all: {} plugin(s), {} enabled", result.len(), enabled);
        result
    }

    // ─── Persistence ───

    fn save_state(&self) {
        let plugins = self.plugins.lock().unwrap();
        let state: BTreeMap<String, Value> = plugins
            .iter()
            .map(|(id, info)| {
                (
                    id.clone(),
                    json!({
                        "enabled": info.enabled,
                        "enabledAt": info.enabled_at,
                        "settings": info.settings,
                        "state": info.state,
                    }),
                )
            })
            .collect();

        if let Some(parent) = self.state_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match serde_json::to_string_pretty(&state) {
            Ok(json) => {
                if let Err(e) = fs::write(&self.state_path, &json) {
                    tracing::error!("[PluginManager] save_state write error: {e} (path={})", self.state_path.display());
                } else {
                    let count = state.len();
                    let enabled = state.values().filter(|v| v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false)).count();
                    tracing::debug!("[PluginManager] save_state wrote {count} plugin(s) ({enabled} enabled) to {}", self.state_path.display());
                }
            }
            Err(e) => {
                tracing::error!("[PluginManager] save_state serialize error: {e}");
            }
        }
    }

    fn load_state(&self) {
        let Ok(content) = fs::read_to_string(&self.state_path) else {
            tracing::warn!("[PluginManager] load_state: no saved state at {} (first run or fresh install)", self.state_path.display());
            return;
        };
        let Ok(state): Result<BTreeMap<String, Value>, _> = serde_json::from_str(&content) else {
            tracing::warn!("[PluginManager] load_state: failed to parse JSON from {}", self.state_path.display());
            return;
        };

        let mut plugins = self.plugins.lock().unwrap();
        let mut restored = 0usize;
        for (id, saved) in &state {
            if let Some(info) = plugins.get_mut(id) {
                if let Some(enabled) = saved.get("enabled").and_then(|v| v.as_bool()) {
                    info.enabled = enabled;
                    info.status = if enabled { PluginStatus::Enabled } else { PluginStatus::Disabled };
                }
                if let Some(at) = saved.get("enabledAt").and_then(|v| v.as_u64()) {
                    info.enabled_at = Some(at);
                }
                if let Some(settings) = saved.get("settings") {
                    info.settings = settings.clone();
                }
                if let Some(state) = saved.get("state") {
                    info.state = state.clone();
                }
                restored += 1;
            }
        }
        let enabled_count = state.values().filter(|v| v.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false)).count();
        tracing::debug!("[PluginManager] load_state: restored {restored} plugin(s) ({enabled_count} enabled) from {}", self.state_path.display());
    }

    fn read_plugin_flp(&self, id: &str) -> Result<Vec<u8>, String> {
        let resource_dir = self.resource_dir.lock().unwrap();
        let user_dir = self.user_dir.lock().unwrap();

        let candidates = [
            resource_dir.join(format!("{id}.flp")),
            user_dir.join(format!("{id}.flp")),
        ];

        for candidate in &candidates {
            if let Ok(data) = fs::read(candidate) {
                return Ok(data);
            }
        }

        Err(format!("Plugin .flp not found for '{}'", id))
    }
}

fn manifest_toml_to_json(manifest_toml: &str) -> Result<Value, String> {
    let manifest: toml::Value = toml::from_str(manifest_toml).map_err(|e| e.to_string())?;
    serde_json::to_value(manifest).map_err(|e| e.to_string())
}

fn parse_manifest_toml(manifest_toml: &str) -> Result<PluginManifest, String> {
    let value = manifest_toml_to_json(manifest_toml)?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_state_path() -> PathBuf {
        std::env::temp_dir().join("flint-test-plugin-state.json")
    }

    fn test_resource_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("plugins")
    }

    fn test_dev_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("debug")
            .join("plugins")
    }

    #[test]
    fn test_discover_empty_prod_dir() {
        let _ = fs::remove_file(test_state_path());
        let mgr = PluginManager::new(test_state_path());
        let dir = test_resource_dir();
        let user_dir = std::env::temp_dir().join("flint-test-user-plugins");
        let _discovered = mgr.discover(&dir, &user_dir);
    }

    #[test]
    fn test_discover_empty_dev_dir() {
        let _ = fs::remove_file(test_state_path());
        let mgr = PluginManager::new(test_state_path());
        let dir = test_dev_dir();
        let user_dir = std::env::temp_dir().join("flint-test-user-plugins");
        let _ = std::fs::create_dir_all(&dir);
        let _discovered = mgr.discover(&dir, &user_dir);
    }
}
