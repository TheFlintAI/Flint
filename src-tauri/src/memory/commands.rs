use serde_json::Value;

use crate::commands::utils::parse_first_arg;
use crate::state::AppState;
use tauri::State;

use super::types::*;

macro_rules! id {
    ($args:expr) => {
        parse_first_arg::<IdParam>($args)?.id
    };
}

pub(crate) async fn handle_memory_channel(
    state: &State<'_, AppState>,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    let db = state
        .memory
        .get()
        .ok_or_else(|| "Memory system not initialized".to_string())?;
    tracing::debug!("[memory] {channel}");
    let r = match channel {
        "memory:list" => serde_json::to_value(db.list(parse_first_arg(args)?)?),
        "memory:read" => serde_json::to_value(db.read(&id!(args))?),
        "memory:search" => serde_json::to_value(db.search(parse_first_arg(args)?)?),
        "memory:write" => serde_json::to_value(db.write(parse_first_arg(args)?)?),
        "memory:delete" => serde_json::to_value(db.delete(&id!(args))?),
        "memory:stats" => serde_json::to_value(db.stats()?),
        "memory:rebuild-index" => serde_json::to_value(db.rebuild()?),
        _ => return Err(format!("Unknown memory channel: {channel}")),
    };
    r.map_err(|e| e.to_string())
}
