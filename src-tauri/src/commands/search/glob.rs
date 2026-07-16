use std::path::PathBuf;
use std::time::Instant;

use serde_json::{json, Value};

use super::output::display_path;
use super::walker::walk_search_files;

use crate::commands::types::GlobArgs;
use crate::commands::utils::compile_glob_pattern;

/// Run a glob search over files in the given directory.
/// Uses the same walker as grep — respects `.gitignore` and
/// always-skipped directories.
pub(crate) fn run_glob(args: GlobArgs) -> Result<Value, String> {
    let started = Instant::now();
    let root = PathBuf::from(args.cwd.as_deref().unwrap_or("."));
    let glob_pattern = compile_glob_pattern(&args.pattern)
        .ok_or_else(|| format!("Invalid glob pattern: {}", args.pattern))?;

    let mut paths: Vec<String> = Vec::new();
    let mut truncated = false;
    let max_results = 200;

    for path in walk_search_files(&root, Some(&glob_pattern), None) {
        if paths.len() >= max_results {
            truncated = true;
            break;
        }
        let rel = display_path(&path, &root);
        paths.push(rel);
    }

    // Also match directories at the root level using the glob crate
    if let Ok(pattern_str) = build_absolute_pattern(&root, &args.pattern) {
        if let Ok(iter) = glob::glob(&pattern_str) {
            for entry in iter.flatten() {
                if paths.len() >= max_results {
                    truncated = true;
                    break;
                }
                let rel = display_path(&entry, &root);
                if !paths.contains(&rel) {
                    paths.push(rel);
                }
            }
        }
    }

    let search_time_ms = started.elapsed().as_millis();

    Ok(json!({
        "kind": "glob",
        "matches": paths,
        "meta": {
            "backend": "local",
            "searchRoot": root.to_string_lossy().to_string(),
            "pathStyle": "relative_to_search_root",
            "truncated": truncated,
            "limitReason": if truncated { json!("maxResults") } else { Value::Null },
            "pattern": args.pattern,
            "searchTime": search_time_ms,
        }
    }))
}

/// Build an absolute glob pattern string from the root and relative pattern.
fn build_absolute_pattern(root: &std::path::Path, pattern: &str) -> Result<String, String> {
    let joined = root.join(pattern);
    Ok(joined.to_string_lossy().to_string())
}
