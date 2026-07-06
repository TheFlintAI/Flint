use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use super::types::ProviderPreset;

/// Manages built-in provider presets loaded from TOML files.
///
/// Mirrors the PluginManager pattern: paths are resolved by the caller
/// via `app.path().resolve(...)` and passed into `load_from_dir`.
/// Internal state uses a Mutex for interior mutability.
pub struct PresetManager {
    presets: Mutex<Vec<ProviderPreset>>,
}

impl PresetManager {
    pub fn new() -> Self {
        Self {
            presets: Mutex::new(Vec::new()),
        }
    }

    /// Scan a directory for `*.toml` preset files and append them.
    /// Errors for individual files are logged and skipped.
    pub fn load_from_dir(&self, dir: &Path) -> Result<usize, String> {
        let entries = fs::read_dir(dir).map_err(|e| {
            format!(
                "[PresetManager] Failed to read directory {}: {e}",
                dir.display()
            )
        })?;

        let mut new_presets: Vec<ProviderPreset> = Vec::new();

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    tracing::warn!("[PresetManager] Read entry error: {e}");
                    continue;
                }
            };
            let path = entry.path();

            if path.extension().map_or(true, |ext| ext != "toml") {
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(
                        "[PresetManager] Failed to read {}: {e}",
                        path.display()
                    );
                    continue;
                }
            };

            #[derive(serde::Deserialize)]
            struct TomlWrapper {
                provider: ProviderPreset,
            }

            let wrapper: TomlWrapper = match toml::from_str(&content) {
                Ok(w) => w,
                Err(e) => {
                    tracing::warn!(
                        "[PresetManager] Failed to parse {}: {e}",
                        path.display()
                    );
                    continue;
                }
            };

            new_presets.push(wrapper.provider);
        }

        let count = new_presets.len();

        let mut presets = self.presets.lock().unwrap();
        presets.extend(new_presets);
        presets.sort_by(|a, b| a.builtin_id.cmp(&b.builtin_id));

        Ok(count)
    }

    /// Return all loaded presets as a JSON value.
    pub fn get_all_json(&self) -> Value {
        let presets = self.presets.lock().unwrap();
        serde_json::to_value(&*presets).unwrap_or(Value::Array(vec![]))
    }

    pub fn len(&self) -> usize {
        self.presets.lock().unwrap().len()
    }
}
