mod filter;
mod glob;
mod grep;
mod output;
mod walker;

use serde_json::Value;

use crate::commands::types::{GlobArgs, GrepArgs};
use crate::commands::utils::parse_first_arg;

/// Tauri command handler for `fs:grep`.
pub(crate) fn grep_files(args: &[Value]) -> Result<Value, String> {
    let input = parse_first_arg::<GrepArgs>(args)?;
    let result = grep::run_grep(input)?;
    Ok(result.to_json())
}

/// Tauri command handler for `fs:glob`.
pub(crate) fn glob_files(args: &[Value]) -> Result<Value, String> {
    let input = parse_first_arg::<GlobArgs>(args)?;
    glob::run_glob(input)
}
