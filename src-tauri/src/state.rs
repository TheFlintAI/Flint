use crate::utils::flint_path;
use portable_pty::MasterPty;
use serde_json::Value;
use shared_child::SharedChild;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::process::ChildStdin;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

use crate::memory::manager::MemorySystem;
use crate::plugin::PluginManager;
use crate::preset::PresetManager;

pub(crate) struct AppState {
    pub(crate) processes: Arc<Mutex<BTreeMap<String, ManagedProcess>>>,
    pub(crate) terminal_tasks: Arc<Mutex<BTreeMap<String, TerminalTask>>>,
    pub(crate) next_process_id: Mutex<u64>,
    pub(crate) file_watchers: Mutex<BTreeMap<String, Arc<AtomicBool>>>,
    pub(crate) plugin_manager: PluginManager,
    pub(crate) preset_manager: PresetManager,
    pub(crate) memory: OnceLock<MemorySystem>,
}

impl AppState {
    pub(crate) fn load() -> Self {
        let plugin_state_path = flint_path("plugin-state.json");

        Self {
            processes: Arc::new(Mutex::new(BTreeMap::new())),
            terminal_tasks: Arc::new(Mutex::new(BTreeMap::new())),
            next_process_id: Mutex::new(1),
            file_watchers: Mutex::new(BTreeMap::new()),
            plugin_manager: PluginManager::new(plugin_state_path),
            preset_manager: PresetManager::new(),
            memory: OnceLock::new(),
        }
    }

    /// Initialize the memory system with the given paths.
    /// Must be called once during app setup before any memory commands are used.
    pub(crate) fn init_memory(&self, db_path: &Path, model_dir: &Path) {
        match MemorySystem::new(db_path, model_dir) {
            Ok(ms) => {
                let _ = self.memory.set(ms);
            }
            Err(e) => {
                tracing::warn!("Memory system not available: {e}");
            }
        }
    }
}

pub(crate) struct ManagedProcess {
    pub(crate) child: Arc<SharedChild>,
    pub(crate) stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) created_at: u128,
    pub(crate) port: Arc<Mutex<Option<u16>>>,
    pub(crate) metadata: Value,
}

pub(crate) struct TerminalTask {
    pub(crate) kind: String,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    pub(crate) shell: String,
    pub(crate) cwd: String,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) created_at: u128,
    pub(crate) title: String,
    pub(crate) command: Option<String>,
    pub(crate) output_buffer: Arc<Mutex<Vec<TerminalOutputChunk>>>,
    pub(crate) exit_code: Arc<Mutex<Option<i32>>>,
}

#[derive(Clone)]
pub(crate) struct TerminalOutputChunk {
    pub(crate) seq: u64,
    pub(crate) data: String,
}
