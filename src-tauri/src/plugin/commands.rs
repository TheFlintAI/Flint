use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::utils::flint_path;

pub fn handle_channel(
    app: &AppHandle,
    state: &tauri::State<'_, AppState>,
    channel: &str,
    args: &[Value],
) -> Result<Value, String> {
    let pm = &state.plugin_manager;
    match channel {
        "plugin:list" => {
            let plugins = pm.list_all();
            Ok(serde_json::to_value(plugins).map_err(|e| e.to_string())?)
        }
        "plugin:enable" => {
            let input = parse_first_arg::<PluginIdArgs>(args)?;
            let manifest = pm.enable(&input.plugin_id)?;
            Ok(json!({ "manifest": manifest }))
        }
        "plugin:get-source" => {
            let input = parse_first_arg::<PluginIdArgs>(args)?;
            let source = pm.get_source(&input.plugin_id)?;
            Ok(json!({ "mainJs": source }))
        }
        "plugin:get-runtime" => {
            let runtime = pm.get_runtime()?;
            Ok(json!({ "runtimeJs": runtime }))
        }
        "plugin:disable" => {
            let input = parse_first_arg::<PluginIdArgs>(args)?;
            pm.disable(&input.plugin_id)?;
            Ok(json!({ "success": true }))
        }
        "plugin:discover" => {
            let plugin_dir = app
                .path()
                .resolve("plugins", tauri::path::BaseDirectory::Resource)
                .map_err(|e| format!("resolve resource path: {e}"))?;
            let user_dir = flint_path("plugins");
            let _ = fs::create_dir_all(&user_dir);
            tracing::debug!("[plugin:discover] plugin_dir={}", plugin_dir.display());
            let discovered = pm.discover(&plugin_dir, &user_dir);
            tracing::debug!("[plugin:discover] found {} plugins", discovered.len());
            Ok(serde_json::to_value(discovered).map_err(|e| e.to_string())?)
        }
        "plugin:import-flp" => {
            let input = parse_first_arg::<ImportFlpArgs>(args)?;
            let user_dir = flint_path("plugins");
            let info = pm.import_flp(&PathBuf::from(&input.path), &user_dir)?;
            tracing::debug!("[plugin:import-flp] imported {}", info.id);
            Ok(json!({ "plugin": info }))
        }
        "plugin:set-setting" => {
            let input = parse_first_arg::<SetSettingArgs>(args)?;
            pm.set_setting(&input.plugin_id, &input.key, input.value)?;
            Ok(json!({ "success": true }))
        }
        "plugin:get-state" => {
            let input = parse_first_arg::<PluginIdArgs>(args)?;
            let state = pm.get_state(&input.plugin_id)?;
            Ok(state)
        }
        "plugin:set-state" => {
            let input = parse_first_arg::<SetStateArgs>(args)?;
            pm.set_state(&input.plugin_id, &input.key, input.value)?;
            Ok(json!({ "success": true }))
        }
        "plugin:delete-state" => {
            let input = parse_first_arg::<DeleteStateArgs>(args)?;
            pm.delete_state(&input.plugin_id, &input.key)?;
            Ok(json!({ "success": true }))
        }
        "plugin:uninstall" => {
            let input = parse_first_arg::<PluginIdArgs>(args)?;
            let user_dir = flint_path("plugins");
            pm.uninstall(&input.plugin_id, &user_dir)?;
            Ok(json!({ "success": true }))
        }
        other => Err(format!("Unknown plugin channel: {other}")),
    }
}

#[derive(Debug, Deserialize)]
struct PluginIdArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
}

#[derive(Debug, Deserialize)]
struct ImportFlpArgs {
    path: String,
}

#[derive(Debug, Deserialize)]
struct SetSettingArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    key: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
struct SetStateArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    key: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
struct DeleteStateArgs {
    #[serde(rename = "pluginId")]
    plugin_id: String,
    key: String,
}

fn parse_first_arg<T: for<'de> Deserialize<'de>>(args: &[Value]) -> Result<T, String> {
    let value = args
        .first()
        .ok_or_else(|| "missing arguments".to_string())?;
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
}
