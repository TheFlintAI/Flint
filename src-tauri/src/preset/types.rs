use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Localized display name — any language code → translation.
/// Deserialized from TOML `[name]` sections as a JSON object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderPreset {
    #[serde(rename = "builtinId")]
    pub builtin_id: String,
    pub name: Value,
    #[serde(rename = "type")]
    pub provider_type: String,
    #[serde(rename = "defaultBaseUrl")]
    pub default_base_url: String,
    pub homepage: String,

    #[serde(rename = "defaultEnabled")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_enabled: Option<bool>,
    #[serde(rename = "requiresApiKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_api_key: Option<bool>,
    #[serde(rename = "userAgent")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(rename = "defaultModel")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(rename = "authMode")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_mode: Option<String>,
    #[serde(rename = "requestOverrides")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_overrides: Option<RequestOverrides>,
    #[serde(rename = "instructionsPrompt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<Value>,
    #[serde(rename = "websocketUrl")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_url: Option<String>,
    #[serde(rename = "websocketMode")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket_mode: Option<String>,
    #[serde(rename = "defaultModels")]
    pub default_models: Vec<ModelPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
    #[serde(rename = "omitBodyKeys")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omit_body_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPreset {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(rename = "type")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(rename = "contextLength")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(rename = "maxOutputTokens")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
    #[serde(rename = "supportsVision")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
    #[serde(rename = "supportsThinking")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_thinking: Option<bool>,
    #[serde(rename = "thinkingConfig")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_config: Option<ThinkingConfigPreset>,
    #[serde(rename = "requestOverrides")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_overrides: Option<RequestOverrides>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingConfigPreset {
    #[serde(rename = "bodyParams")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_params: Option<Value>,
    #[serde(rename = "disabledBodyParams")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_body_params: Option<Value>,
    #[serde(rename = "forceTemperature")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_temperature: Option<f64>,
    #[serde(rename = "reasoningEffortLevels")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort_levels: Option<Vec<String>>,
    #[serde(rename = "defaultReasoningEffort")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_reasoning_effort: Option<String>,
}
