use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PluginStatus {
    Installed,
    Enabled,
    Disabled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: Value,
    pub version: String,
    #[serde(rename = "displayDescription")]
    pub display_description: Option<Value>,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub main: String,
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub manifest: PluginManifest,
    pub status: PluginStatus,
    pub enabled: bool,
    pub size: u64,
    #[serde(rename = "installedAt")]
    pub installed_at: u64,
    #[serde(rename = "enabledAt")]
    pub enabled_at: Option<u64>,
    pub settings: Value,
    #[serde(default)]
    pub state: Value,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
}
