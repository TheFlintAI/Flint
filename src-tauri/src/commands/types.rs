use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeVersions {
    pub(crate) tauri: String,
    pub(crate) webview: Option<String>,
    pub(crate) chrome: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PathArg {
    pub(crate) path: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WriteFileArgs {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WriteBinaryFileArgs {
    pub(crate) path: String,
    pub(crate) data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadFileArgs {
    pub(crate) path: String,
    pub(crate) offset: Option<usize>,
    pub(crate) limit: Option<usize>,
    pub(crate) pages: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListDirArgs {
    pub(crate) path: String,
    pub(crate) ignore: Option<Vec<String>>,
    pub(crate) limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlobArgs {
    pub(crate) cwd: Option<String>,
    pub(crate) pattern: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrepArgs {
    pub(crate) pattern: String,
    pub(crate) path: Option<String>,
    pub(crate) include: Option<String>,
    pub(crate) exclude: Option<String>,
    pub(crate) ignore_case: Option<bool>,
    pub(crate) case_sensitive: Option<bool>,
    pub(crate) literal: Option<bool>,
    pub(crate) output_mode: Option<String>,
    pub(crate) max_results: Option<usize>,
    pub(crate) max_line_length: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellExecArgs {
    pub(crate) command: String,
    pub(crate) cwd: Option<String>,
    pub(crate) shell: Option<String>,
    #[serde(alias = "execId")]
    pub(crate) exec_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessSpawnArgs {
    pub(crate) command: String,
    pub(crate) cwd: Option<String>,
    pub(crate) shell: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) cols: Option<u16>,
    pub(crate) rows: Option<u16>,
    pub(crate) metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct IdArg {
    #[serde(alias = "taskId", alias = "connectionId")]
    pub(crate) id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessWriteArgs {
    #[serde(alias = "taskId")]
    pub(crate) id: String,
    #[serde(alias = "data")]
    pub(crate) input: String,
    pub(crate) append_newline: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TerminalResizeArgs {
    #[serde(alias = "taskId")]
    pub(crate) id: String,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

#[derive(Debug, Serialize)]
pub(crate) struct FsEntry {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_dir: bool,
    pub(crate) is_file: bool,
    pub(crate) size: u64,
    pub(crate) modified: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotifyOptions {
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) task_id: String,
}
