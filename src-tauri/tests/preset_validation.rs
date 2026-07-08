/// Comprehensive validation tests for all AI provider preset TOML files.
///
/// Run with: cargo test --test preset_validation -- --nocapture
///
/// Validates:
/// 1. TOML parseability into ProviderPreset structs
/// 2. Required field presence and validity
/// 3. URL format correctness
/// 4. Provider type validity
/// 5. defaultModel exists in defaultModels list
/// 6. Thinking config consistency
/// 7. Model ID format

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

// ── Duplicated from src/preset/types.rs to keep the test self-contained ──────

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RequestOverrides {
    #[allow(dead_code)]
    headers: Option<Value>,
    #[allow(dead_code)]
    body: Option<Value>,
    #[serde(rename = "omitBodyKeys")]
    #[allow(dead_code)]
    omit_body_keys: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ThinkingConfigPreset {
    #[serde(rename = "bodyParams")]
    body_params: Option<Value>,
    #[serde(rename = "disabledBodyParams")]
    disabled_body_params: Option<Value>,
    #[serde(rename = "forceTemperature")]
    force_temperature: Option<f64>,
    #[serde(rename = "reasoningEffortLevels")]
    reasoning_effort_levels: Option<Vec<String>>,
    #[serde(rename = "defaultReasoningEffort")]
    default_reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ModelPreset {
    id: String,
    name: String,
    #[serde(default = "default_enabled")]
    #[allow(dead_code)]
    enabled: bool,
    #[serde(rename = "type")]
    model_type: Option<String>,
    category: Option<String>,
    icon: Option<String>,
    #[serde(rename = "contextLength")]
    context_length: Option<u64>,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: Option<u64>,
    #[serde(rename = "supportsVision")]
    supports_vision: Option<bool>,
    #[serde(rename = "supportsThinking")]
    supports_thinking: Option<bool>,
    #[serde(rename = "thinkingConfig")]
    thinking_config: Option<ThinkingConfigPreset>,
    #[serde(rename = "requestOverrides")]
    request_overrides: Option<RequestOverrides>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ProviderPreset {
    #[serde(rename = "builtinId")]
    builtin_id: String,
    name: Value,
    #[serde(rename = "type")]
    provider_type: String,
    #[serde(rename = "defaultBaseUrl")]
    default_base_url: String,
    homepage: String,
    #[serde(rename = "defaultEnabled")]
    default_enabled: Option<bool>,
    #[serde(rename = "requiresApiKey")]
    requires_api_key: Option<bool>,
    #[serde(rename = "userAgent")]
    user_agent: Option<String>,
    #[serde(rename = "defaultModel")]
    default_model: Option<String>,
    #[serde(rename = "authMode")]
    auth_mode: Option<String>,
    #[serde(rename = "requestOverrides")]
    request_overrides: Option<RequestOverrides>,
    #[serde(rename = "instructionsPrompt")]
    instructions_prompt: Option<String>,
    ui: Option<Value>,
    #[serde(rename = "websocketUrl")]
    websocket_url: Option<String>,
    #[serde(rename = "websocketMode")]
    websocket_mode: Option<String>,
    #[serde(rename = "defaultModels")]
    default_models: Vec<ModelPreset>,
}

#[derive(Debug, Deserialize)]
struct TomlWrapper {
    provider: ProviderPreset,
}

// ── Constants ────────────────────────────────────────────────────────────────

const PRESETS_DIR: &str = "resources/presets";
const VALID_PROVIDER_TYPES: &[&str] = &[
    "openai-chat",
    "openai-responses",
    "openai-images",
    "anthropic",
    "gemini",
    "vertex-ai",
];
const VALID_MODEL_TYPES: &[&str] = &[
    "openai-chat",
    "openai-responses",
    "openai-images",
    "anthropic",
    "gemini",
];
const VALID_CATEGORIES: &[&str] = &["chat", "image", "embedding", "speech"];

// ── Helpers ──────────────────────────────────────────────────────────────────

fn load_all_presets() -> Vec<(String, ProviderPreset)> {
    let dir = Path::new(PRESETS_DIR);
    assert!(dir.exists(), "Presets directory not found: {}", PRESETS_DIR);

    let mut results = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(dir)
        .expect("Failed to read presets directory")
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        if path.extension().map_or(true, |ext| ext != "toml") {
            continue;
        }

        let content = fs::read_to_string(&path).expect(&format!(
            "Failed to read preset file: {}",
            path.display()
        ));

        let wrapper: TomlWrapper = toml::from_str(&content).expect(&format!(
            "Failed to parse TOML: {}",
            path.display()
        ));

        let stem = path.file_stem().unwrap().to_str().unwrap().to_string();
        results.push((stem, wrapper.provider));
    }

    results
}

fn extract_name(value: &Value) -> String {
    value
        .as_object()
        .and_then(|obj| {
            obj.get("en")
                .or_else(|| obj.get("zh"))
                .or_else(|| obj.values().next())
        })
        .and_then(|v| v.as_str())
        .unwrap_or("(no name)")
        .to_string()
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[test]
fn test_all_presets_parse_successfully() {
    let presets = load_all_presets();
    assert!(!presets.is_empty(), "No presets found!");
    println!("\n═══ Loaded {} presets ═══", presets.len());
    for (file, preset) in &presets {
        let name = extract_name(&preset.name);
        println!(
            "  {:20} | {:25} | {:12} | {} model(s)",
            file,
            name,
            preset.provider_type,
            preset.default_models.len()
        );
    }
}

#[test]
fn test_provider_required_fields() {
    let presets = load_all_presets();

    for (file, preset) in &presets {
        let name = extract_name(&preset.name);

        // builtinId must be non-empty and match filename convention
        assert!(
            !preset.builtin_id.is_empty(),
            "[{file}] builtinId is empty"
        );

        // name must be a valid object with at least one language
        let name_obj = preset
            .name
            .as_object()
            .expect(&format!("[{file}] name must be a TOML table"));
        assert!(
            !name_obj.is_empty(),
            "[{file}] name table is empty"
        );

        // type must be a valid provider type
        assert!(
            VALID_PROVIDER_TYPES.contains(&preset.provider_type.as_str()),
            "[{file}] Invalid provider type: '{}'. Must be one of {:?}",
            preset.provider_type,
            VALID_PROVIDER_TYPES
        );

        // defaultBaseUrl: must be empty (user-configured, e.g. Azure),
        // a valid https:// URL, or a localhost http:// URL (e.g. Ollama)
        if !preset.default_base_url.is_empty() {
            let is_https = preset.default_base_url.starts_with("https://");
            let is_localhost = preset.default_base_url.starts_with("http://localhost")
                || preset.default_base_url.starts_with("http://127.0.0.1");
            assert!(
                is_https || is_localhost,
                "[{file}] defaultBaseUrl must start with https:// (or http://localhost), got: {}",
                preset.default_base_url
            );
            assert!(
                !preset.default_base_url.ends_with('/'),
                "[{file}] defaultBaseUrl should not end with '/': {}",
                preset.default_base_url
            );
        } else {
            println!(
                "  ⚠ {:20} | Empty defaultBaseUrl (user-provided endpoint required)",
                file
            );
        }

        // homepage must be a valid URL
        assert!(
            preset.homepage.starts_with("https://") || preset.homepage.starts_with("http://"),
            "[{file}] homepage must be a valid URL: {}",
            preset.homepage
        );

        // Must have at least one model
        assert!(
            !preset.default_models.is_empty(),
            "[{file}] defaultModels is empty"
        );

        println!(
            "  ✓ {:20} | {} | type={} | {} models",
            file,
            name,
            preset.provider_type,
            preset.default_models.len()
        );
    }
}

#[test]
fn test_models_have_valid_ids() {
    let presets = load_all_presets();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for (file, preset) in &presets {
        for model in &preset.default_models {
            // ID must be non-empty
            assert!(
                !model.id.is_empty(),
                "[{file}] Model has empty id"
            );

            // ID must not contain whitespace
            assert!(
                !model.id.contains(char::is_whitespace),
                "[{file}] Model id '{}' contains whitespace",
                model.id
            );

            // Name must be non-empty
            assert!(
                !model.name.is_empty(),
                "[{file}] Model '{}' has empty name",
                model.id
            );

            // contextLength should be reasonable (at least 4096)
            if let Some(ctx) = model.context_length {
                assert!(
                    ctx >= 4096,
                    "[{file}] Model '{}' contextLength={ctx} is suspiciously small (< 4096)",
                    model.id
                );
                assert!(
                    ctx <= 100_000_000,
                    "[{file}] Model '{}' contextLength={ctx} is suspiciously large (> 100M)",
                    model.id
                );
            }

            // maxOutputTokens should be reasonable
            if let Some(max_out) = model.max_output_tokens {
                assert!(
                    max_out >= 1,
                    "[{file}] Model '{}' maxOutputTokens={max_out} is invalid",
                    model.id
                );
                assert!(
                    max_out <= 1_000_000,
                    "[{file}] Model '{}' maxOutputTokens={max_out} is suspiciously large (> 1M)",
                    model.id
                );
            }

            // Validate model_type if present
            if let Some(ref mt) = model.model_type {
                assert!(
                    VALID_MODEL_TYPES.contains(&mt.as_str()),
                    "[{file}] Model '{}' has invalid type: '{}'. Must be one of {:?}",
                    model.id,
                    mt,
                    VALID_MODEL_TYPES
                );
            }

            // Validate category if present
            if let Some(ref cat) = model.category {
                assert!(
                    VALID_CATEGORIES.contains(&cat.as_str()),
                    "[{file}] Model '{}' has invalid category: '{}'. Must be one of {:?}",
                    model.id,
                    cat,
                    VALID_CATEGORIES
                );
            }

            // Track duplicate IDs (across all presets — informational only)
            let global_id = format!("{}::{}", preset.builtin_id, model.id);
            if !seen_ids.insert(global_id.clone()) {
                println!(
                    "  ⚠ Duplicate model id across presets: {}",
                    global_id
                );
            }
        }
    }

    println!(
        "  ✓ All model IDs valid across {} presets ({} unique provider::model pairs)",
        presets.len(),
        seen_ids.len()
    );
}

#[test]
fn test_default_model_exists_in_list() {
    let presets = load_all_presets();

    for (file, preset) in &presets {
        if let Some(ref default_model) = preset.default_model {
            let model_ids: Vec<&str> = preset
                .default_models
                .iter()
                .map(|m| m.id.as_str())
                .collect();

            assert!(
                model_ids.contains(&default_model.as_str()),
                "[{file}] defaultModel '{default_model}' not found in defaultModels list: {:?}",
                model_ids
            );

            println!(
                "  ✓ {:20} | defaultModel='{default_model}' exists in models list",
                file
            );
        } else {
            // No defaultModel specified — first model will be used by convention
            println!(
                "  ⚠ {:20} | No defaultModel set (first model '{}' used by default)",
                file,
                preset.default_models.first().map(|m| m.id.as_str()).unwrap_or("?")
            );
        }
    }
}

#[test]
fn test_thinking_config_consistency() {
    let presets = load_all_presets();

    for (file, preset) in &presets {
        for model in &preset.default_models {
            let supports_thinking = model.supports_thinking.unwrap_or(false);

            if supports_thinking {
                // Models that support thinking SHOULD have thinkingConfig
                if model.thinking_config.is_none() {
                    println!(
                        "  ⚠ {:20} | Model '{}' supportsThinking=true but has no thinkingConfig",
                        file,
                        model.id
                    );
                }
            }

            if let Some(ref tc) = model.thinking_config {
                // If reasoningEffortLevels is set, defaultReasoningEffort should be one of them
                if let Some(ref levels) = tc.reasoning_effort_levels {
                    assert!(
                        !levels.is_empty(),
                        "[{file}] Model '{}' reasoningEffortLevels list is empty",
                        model.id
                    );

                    if let Some(ref default_effort) = tc.default_reasoning_effort {
                        assert!(
                            levels.contains(default_effort),
                            "[{file}] Model '{}' defaultReasoningEffort='{default_effort}' not in reasoningEffortLevels={:?}",
                            model.id,
                            levels
                        );
                    }

                    // Validate that level names are known
                    let known_levels: HashSet<&str> = [
                        "none", "low", "medium", "high", "xhigh", "max",
                    ]
                    .iter()
                    .cloned()
                    .collect();
                    for level in levels {
                        assert!(
                            known_levels.contains(level.as_str()),
                            "[{file}] Model '{}' has unknown reasoningEffortLevel '{}'. Known: {:?}",
                            model.id,
                            level,
                            known_levels
                        );
                    }
                }

                // bodyParams and disabledBodyParams should be objects if present
                if let Some(ref bp) = tc.body_params {
                    assert!(
                        bp.is_object(),
                        "[{file}] Model '{}' thinkingConfig.bodyParams must be a TOML table",
                        model.id
                    );
                }
                if let Some(ref dbp) = tc.disabled_body_params {
                    assert!(
                        dbp.is_object(),
                        "[{file}] Model '{}' thinkingConfig.disabledBodyParams must be a TOML table",
                        model.id
                    );
                }

                // forceTemperature should be in valid range
                if let Some(ft) = tc.force_temperature {
                    assert!(
                        ft >= 0.0 && ft <= 2.0,
                        "[{file}] Model '{}' forceTemperature={ft} out of range [0.0, 2.0]",
                        model.id
                    );
                }
            }

            // If supportsThinking is false but thinkingConfig exists, warn
            if !supports_thinking && model.thinking_config.is_some() {
                println!(
                    "  ⚠ {:20} | Model '{}' supportsThinking=false but has thinkingConfig",
                    file,
                    model.id
                );
            }
        }
    }

    println!("  ✓ Thinking config consistency checked across all presets");
}

#[test]
fn test_provider_type_has_matching_api_format() {
    let presets = load_all_presets();

    for (file, preset) in &presets {
        let url = &preset.default_base_url;

        // Skip URL format validation for providers with user-configured endpoints
        if url.is_empty() {
            println!(
                "  ⊘ {:20} | Skipping URL validation (user-provided endpoint)",
                file
            );
            continue;
        }

        match preset.provider_type.as_str() {
            "openai-chat" | "openai-responses" | "openai-images" => {
                // OpenAI-compatible endpoints typically end with /v1
                // But some providers use /v2, /v3, /v4, /paas/v4, /compatible-mode/v1 etc.
                let has_version_segment = url.contains("/v1")
                    || url.contains("/v2")
                    || url.contains("/v3")
                    || url.contains("/v4")
                    || url.contains("/v1beta");
                if !has_version_segment {
                    println!(
                        "  ⚠ {:20} | openai-chat URL without explicit version segment: {url}",
                        file
                    );
                }

                // Verify the URL is usable as a base for /chat/completions
                let full_url = format!("{url}/chat/completions");
                let is_valid = full_url.starts_with("https://")
                    || full_url.starts_with("http://localhost")
                    || full_url.starts_with("http://127.0.0.1");
                assert!(
                    is_valid,
                    "[{file}] Constructed chat completions URL is invalid: {full_url}"
                );
            }
            "anthropic" => {
                // Anthropic endpoints should accept /v1/messages (handled in anthropic.ts)
                let full_url = format!("{url}/v1/messages");
                let is_valid = full_url.starts_with("https://")
                    || full_url.starts_with("http://localhost")
                    || full_url.starts_with("http://127.0.0.1");
                assert!(
                    is_valid,
                    "[{file}] Constructed Anthropic messages URL is invalid: {full_url}"
                );
            }
            "gemini" | "vertex-ai" => {
                // Gemini endpoints should have a version path
                let full_url = format!("{url}/models/gemini-test:streamGenerateContent");
                assert!(
                    full_url.starts_with("https://"),
                    "[{file}] Constructed Gemini URL is invalid: {full_url}"
                );
            }
            other => {
                panic!("[{file}] Unhandled provider type in test: {other}");
            }
        }
    }

    println!("  ✓ API URL format validated for all presets");
}

#[test]
fn test_preset_summary() {
    let presets = load_all_presets();

    println!("\n╔══════════════════════════════════════════════════════════════╗");
    println!("║           AI Provider Preset Validation Report               ║");
    println!("╠══════════════════════════════════════════════════════════════╣");

    let total_models: usize = presets.iter().map(|(_, p)| p.default_models.len()).sum();

    println!("║ Presets: {:2}  |  Total Models: {:3}                          ║", presets.len(), total_models);
    println!("╠══════════════════════════════════════════════════════════════╣");

    for (file, preset) in &presets {
        let name = extract_name(&preset.name);
        let thinking_count = preset
            .default_models
            .iter()
            .filter(|m| m.supports_thinking.unwrap_or(false))
            .count();
        let vision_count = preset
            .default_models
            .iter()
            .filter(|m| m.supports_vision.unwrap_or(false))
            .count();

        println!(
            "║ {:16} │ {:22} │ {:3} models │ think:{:2} vision:{:2} ║",
            file,
            name,
            preset.default_models.len(),
            thinking_count,
            vision_count
        );
    }

    println!("╚══════════════════════════════════════════════════════════════╝\n");

    // Provider type distribution
    let mut type_counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (_, preset) in &presets {
        *type_counts.entry(preset.provider_type.as_str()).or_default() += 1;
    }
    println!("Provider type distribution:");
    for (t, c) in &type_counts {
        println!("  {t}: {c}");
    }

    // Api key requirements
    let requiring_keys: Vec<_> = presets
        .iter()
        .filter(|(_, p)| p.requires_api_key.unwrap_or(false))
        .map(|(f, p)| (f.as_str(), extract_name(&p.name)))
        .collect();
    if !requiring_keys.is_empty() {
        println!("\nProviders requiring API key:");
        for (file, name) in &requiring_keys {
            println!("  {file} ({name})");
        }
    }
}

#[test]
fn test_anthropic_thinking_body_params_format() {
    // For "anthropic" type providers, thinking body_params must use
    // `type: "enabled"` or `type: "adaptive"` format (Anthropic API spec).
    let presets = load_all_presets();

    for (file, preset) in &presets {
        for model in &preset.default_models {
            if let Some(ref tc) = model.thinking_config {
                if let Some(ref bp) = tc.body_params {
                    if let Some(thinking_type) = bp.get("type").and_then(|v| v.as_str()) {
                        // Valid Anthropic thinking types
                        assert!(
                            thinking_type == "enabled" || thinking_type == "adaptive",
                            "[{file}] Model '{}' thinkingConfig.bodyParams.thinking.type='{thinking_type}' is invalid. Must be 'enabled' or 'adaptive'",
                            model.id
                        );

                        println!(
                            "  ✓ {:20} | Model '{}' thinking type: {thinking_type}",
                            file,
                            model.id
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn test_provider_builtin_id_matches_filename() {
    let presets = load_all_presets();

    for (file, preset) in &presets {
        // The builtinId should match the filename (without .toml)
        assert_eq!(
            &preset.builtin_id, file,
            "builtinId '{}' does not match filename '{file}'",
            preset.builtin_id
        );
    }
    println!("  ✓ All builtinIds match their filenames");
}
