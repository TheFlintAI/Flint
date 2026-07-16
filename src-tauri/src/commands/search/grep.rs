use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Instant;

use regex::Regex;

use super::output::{display_path, truncate_line, GrepMatch, GrepResult, SearchMeta};
use super::walker::walk_search_files;

use crate::commands::types::GrepArgs;
use crate::commands::utils::compile_glob_pattern;

/// Run a grep search over files in the given directory.
///
/// Each file is read independently — a failure to read or decode one file
/// adds a warning and continues to the next file instead of aborting the
/// entire search.
pub(crate) fn run_grep(args: GrepArgs) -> Result<GrepResult, String> {
    let started = Instant::now();
    let root = PathBuf::from(args.path.as_deref().unwrap_or("."));
    let output_mode = args.output_mode.unwrap_or_else(|| "filesWithMatches".to_string());
    let max_results = args.max_results.unwrap_or(200).min(1000);
    let max_line_len = args.max_line_length.unwrap_or(500).min(4000);
    let case_sensitive = args.case_sensitive.unwrap_or(true) && !args.ignore_case.unwrap_or(false);

    let include_pat = args.include.as_deref().and_then(compile_glob_pattern);
    let exclude_pat = args.exclude.as_deref().and_then(compile_glob_pattern);

    let matcher = build_matcher(
        &args.pattern,
        args.literal.unwrap_or(false),
        case_sensitive,
    )?;

    let mut result = GrepResult {
        matches: Vec::new(),
        meta: SearchMeta::new(
            root.to_string_lossy().to_string(),
            args.pattern.clone(),
            output_mode.clone(),
        ),
    };

    for path in walk_search_files(&root, include_pat.as_ref(), exclude_pat.as_ref()) {
        if result.matches.len() >= max_results {
            result.meta.truncated = true;
            result.meta.limit_reason = Some("maxResults".into());
            break;
        }

        // Binary detection — skip non-text files with a counter
        if !super::filter::is_text_file(&path) {
            result.meta.files_skipped += 1;
            continue;
        }

        let remaining = max_results - result.matches.len();
        match search_file(&path, &matcher, &output_mode, remaining, max_line_len) {
            Ok(mut file_matches) => result.matches.append(&mut file_matches),
            Err(warning) => result.meta.warnings.push(warning),
        }
    }

    result.meta.search_time_ms = started.elapsed().as_millis();
    Ok(result)
}

// ── Pattern matching ─────────────────────────────────────────────────

enum Matcher {
    Regex(Regex),
    Literal { pattern: String, case_sensitive: bool },
}

impl Matcher {
    fn find(&self, haystack: &str) -> Option<usize> {
        match self {
            Matcher::Regex(re) => re.find(haystack).map(|m| m.start() + 1),
            Matcher::Literal { pattern, case_sensitive: true } => {
                haystack.find(pattern.as_str()).map(|i| i + 1)
            }
            Matcher::Literal { pattern, case_sensitive: false } => {
                haystack.to_lowercase().find(&pattern.to_lowercase()).map(|i| i + 1)
            }
        }
    }
}

fn build_matcher(pattern: &str, literal: bool, case_sensitive: bool) -> Result<Matcher, String> {
    if literal {
        return Ok(Matcher::Literal {
            pattern: pattern.to_string(),
            case_sensitive,
        });
    }
    Regex::new(pattern)
        .map(Matcher::Regex)
        .map_err(|e| format!("Invalid regex pattern: {e}"))
}

// ── Per-file search ──────────────────────────────────────────────────

/// Search a single file. Returns `Ok(Vec)` on success or `Err(warning)` on
/// failure — individual file failures never abort the entire search.
fn search_file(
    path: &Path,
    matcher: &Matcher,
    output_mode: &str,
    max_results: usize,
    max_line_len: usize,
) -> Result<Vec<GrepMatch>, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let reader = BufReader::new(file);

    let mut matches: Vec<GrepMatch> = Vec::new();
    let mut count: usize = 0;

    // Use split(b'\n') instead of lines() — handles non-UTF-8 content
    // gracefully by falling back to lossy conversion per line.
    for (line_num, line_result) in reader.split(b'\n').enumerate() {
        let line_bytes = line_result
            .map_err(|e| format!("Error reading {}: {e}", path.display()))?;

        // Strip trailing \r for Windows line endings
        let line_bytes = line_bytes.strip_suffix(b"\r").unwrap_or(&line_bytes);

        // UTF-8 tolerant decoding
        let line = String::from_utf8(line_bytes.to_vec())
            .unwrap_or_else(|_| String::from_utf8_lossy(line_bytes).into_owned());

        if let Some(column) = matcher.find(&line) {
            count += 1;

            if output_mode == "count" {
                continue;
            }

            if output_mode == "filesWithMatches" {
                let rel_path = display_path(path, &PathBuf::from("."));
                matches.push(GrepMatch {
                    path: rel_path,
                    line: None,
                    column: None,
                    text: String::new(),
                    kind: "match",
                    count: None,
                });
                return Ok(matches);
            }

            // "content" mode (default): include line number, column, text
            let rel_path = display_path(path, &PathBuf::from("."));
            let text = truncate_line(&line, max_line_len);
            matches.push(GrepMatch {
                path: rel_path,
                line: Some(line_num + 1),
                column: Some(column),
                text,
                kind: "match",
                count: None,
            });

            if matches.len() >= max_results {
                break;
            }
        }
    }

    if output_mode == "count" && count > 0 {
        let rel_path = display_path(path, &PathBuf::from("."));
        matches.push(GrepMatch {
            path: rel_path,
            line: None,
            column: None,
            text: String::new(),
            kind: "match",
            count: Some(count),
        });
    }

    Ok(matches)
}
