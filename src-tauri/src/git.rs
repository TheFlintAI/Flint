use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn handle_channel(channel: &str, args: &[Value]) -> Result<Value, String> {
    let input = args.first().cloned().unwrap_or_else(|| json!({}));
    let cwd = input
        .get("cwd")
        .or_else(|| input.get("rootPath"))
        .and_then(Value::as_str)
        .unwrap_or(".");
    match channel {
        "git:scan-repositories" => scan_git_repositories(&input),
        "git:get-head" => git_success_with(
            cwd,
            &["rev-parse", "HEAD"],
            |stdout| json!({ "success": true, "head": stdout.trim() }),
        ),
        "git:get-range-commits" => {
            let from = input
                .get("from")
                .and_then(Value::as_str)
                .unwrap_or("HEAD~10");
            let to = input.get("to").and_then(Value::as_str).unwrap_or("HEAD");
            git_success_with(
                cwd,
                &["log", "--oneline", &format!("{from}..{to}")],
                |stdout| json!({ "success": true, "commits": stdout.lines().collect::<Vec<_>>() }),
            )
        }
        "git:get-changed-files" => git_success_with(
            cwd,
            &["diff", "--name-only", "HEAD"],
            |stdout| json!({ "success": true, "files": non_empty_lines(stdout) }),
        ),
        "git:get-status" => git_success_with(
            cwd,
            &["status", "--short"],
            |stdout| json!({ "success": true, "status": stdout }),
        ),
        "git:get-repo-summary" => git_repo_summary(cwd),
        "git:get-status-detailed" => git_status_detailed(cwd),
        "git:get-file-diff" => {
            let file = input
                .get("filePath")
                .or_else(|| input.get("path"))
                .and_then(Value::as_str);
            let staged = input
                .get("staged")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut git_args = vec!["diff".to_string()];
            if staged {
                git_args.push("--cached".to_string());
            }
            if let Some(file) = file {
                git_args.push("--".to_string());
                git_args.push(file.to_string());
            }
            git_success_with_owned(
                cwd,
                git_args,
                |stdout| json!({ "success": true, "diff": stdout }),
            )
        }
        "git:get-file-diff-at-commit" => {
            let file = input
                .get("filePath")
                .or_else(|| input.get("path"))
                .and_then(Value::as_str);
            let commit = input
                .get("commitHash")
                .or_else(|| input.get("commit"))
                .and_then(Value::as_str)
                .unwrap_or("HEAD");
            let mut git_args = vec![
                "show".to_string(),
                "--format=".to_string(),
                commit.to_string(),
            ];
            if let Some(file) = file {
                git_args.push("--".to_string());
                git_args.push(file.to_string());
            }
            git_success_with_owned(
                cwd,
                git_args,
                |stdout| json!({ "success": true, "diff": stdout }),
            )
        }
        "git:get-staged-diff-bundle" => {
            let stat = git_output(cwd, &["diff", "--cached", "--stat"])?;
            let patch = git_output(cwd, &["diff", "--cached"])?;
            Ok(
                json!({ "success": true, "stat": stat.stdout, "patch": patch.stdout, "empty": patch.stdout.trim().is_empty() }),
            )
        }
        "git:get-commit-history" => git_commit_history(cwd, &input, None),
        "git:get-file-history" => {
            let file = input
                .get("filePath")
                .or_else(|| input.get("path"))
                .and_then(Value::as_str);
            git_commit_history(cwd, &input, file)
        }
        "git:list-branches" => git_list_branches(cwd),
        "git:fetch" => git_success(cwd, &["fetch", "--all", "--prune"]),
        "git:pull-rebase" => git_success(cwd, &["pull", "--rebase"]),
        "git:push" => git_success(cwd, &["push"]),
        "git:create-branch" => {
            let name = required_str(&input, "name")?;
            let start = input.get("startPoint").and_then(Value::as_str);
            let mut git_args = vec!["branch".to_string(), name.to_string()];
            if let Some(start) = start {
                git_args.push(start.to_string());
            }
            git_success_owned(cwd, git_args)
        }
        "git:checkout-branch" => git_success(cwd, &["checkout", required_str(&input, "name")?]),
        "git:merge-branch" => git_success(cwd, &["merge", required_str(&input, "ref")?]),
        "git:rebase-branch" => git_success(cwd, &["rebase", required_str(&input, "ref")?]),
        "git:delete-local-branch" => {
            let flag = if input.get("force").and_then(Value::as_bool).unwrap_or(false) {
                "-D"
            } else {
                "-d"
            };
            git_success(cwd, &["branch", flag, required_str(&input, "name")?])
        }
        "git:delete-remote-branch" => git_success(
            cwd,
            &[
                "push",
                required_str(&input, "remote")?,
                "--delete",
                required_str(&input, "branchName")?,
            ],
        ),
        "git:rename-branch" => {
            let new_name = required_str(&input, "newName")?;
            if let Some(old_name) = input.get("oldName").and_then(Value::as_str) {
                git_success(cwd, &["branch", "-m", old_name, new_name])
            } else {
                git_success(cwd, &["branch", "-m", new_name])
            }
        }
        "git:stage-files" => git_path_command(cwd, "add", &input),
        "git:unstage-files" => git_reset_paths(cwd, &input),
        "git:stage-all" => git_success(cwd, &["add", "-A"]),
        "git:unstage-all" => git_success(cwd, &["reset"]),
        "git:discard-files" => git_discard(cwd, &input),
        "git:commit" => git_success(cwd, &["commit", "-m", required_str(&input, "message")?]),
        _ => Err(format!("Unknown Tauri git command channel: {channel}")),
    }
}

struct CmdOutput {
    stdout: String,
    stderr: String,
    code: i32,
}

fn git_output(cwd: &str, args: &[&str]) -> Result<CmdOutput, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| error.to_string())?;
    Ok(CmdOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code().unwrap_or(1),
    })
}

fn git_output_owned(cwd: &str, args: Vec<String>) -> Result<CmdOutput, String> {
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    git_output(cwd, &refs)
}

fn git_success(cwd: &str, args: &[&str]) -> Result<Value, String> {
    git_success_with(
        cwd,
        args,
        |stdout| json!({ "success": true, "stdout": stdout }),
    )
}

fn git_success_owned(cwd: &str, args: Vec<String>) -> Result<Value, String> {
    git_success_with_owned(
        cwd,
        args,
        |stdout| json!({ "success": true, "stdout": stdout }),
    )
}

fn git_success_with<F>(cwd: &str, args: &[&str], ok: F) -> Result<Value, String>
where
    F: FnOnce(String) -> Value,
{
    let result = git_output(cwd, args)?;
    if result.code == 0 {
        Ok(ok(result.stdout))
    } else {
        Ok(json!({ "success": false, "error": result.stderr, "exitCode": result.code }))
    }
}

fn git_success_with_owned<F>(cwd: &str, args: Vec<String>, ok: F) -> Result<Value, String>
where
    F: FnOnce(String) -> Value,
{
    let result = git_output_owned(cwd, args)?;
    if result.code == 0 {
        Ok(ok(result.stdout))
    } else {
        Ok(json!({ "success": false, "error": result.stderr, "exitCode": result.code }))
    }
}

fn git_repo_summary(cwd: &str) -> Result<Value, String> {
    let branch = git_output(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?.stdout;
    let upstream = git_output(
        cwd,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()
    .filter(|output| output.code == 0)
    .map(|output| output.stdout.trim().to_string());
    Ok(json!({
        "success": true,
        "summary": {
            "branch": branch.trim(),
            "upstream": upstream,
            "ahead": 0,
            "behind": 0
        }
    }))
}

fn git_status_detailed(cwd: &str) -> Result<Value, String> {
    let branch = git_output(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?.stdout;
    let status = git_output(cwd, &["status", "--porcelain=v1", "-b"])?;
    if status.code != 0 {
        return Ok(json!({ "success": false, "error": status.stderr }));
    }
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();
    let mut conflicted = Vec::new();
    for line in status
        .stdout
        .lines()
        .filter(|line| !line.starts_with("## "))
    {
        if line.len() < 4 {
            continue;
        }
        let staged_status = line.chars().next().unwrap_or(' ').to_string();
        let unstaged_status = line.chars().nth(1).unwrap_or(' ').to_string();
        let path = line[3..].to_string();
        let item = json!({
            "path": path,
            "stagedStatus": staged_status,
            "unstagedStatus": unstaged_status
        });
        if staged_status == "?" && unstaged_status == "?" {
            untracked.push(item);
        } else if staged_status == "U" || unstaged_status == "U" {
            conflicted.push(item);
        } else {
            if staged_status.trim().is_empty() {
                unstaged.push(item);
            } else {
                staged.push(item.clone());
                if !unstaged_status.trim().is_empty() {
                    unstaged.push(item);
                }
            }
        }
    }
    Ok(json!({
        "success": true,
        "status": {
            "branch": branch.trim(),
            "ahead": 0,
            "behind": 0,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
            "conflicted": conflicted
        }
    }))
}

fn git_commit_history(cwd: &str, input: &Value, file: Option<&str>) -> Result<Value, String> {
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .to_string();
    let skip = input
        .get("skip")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .to_string();
    let format = "%H%x01%h%x01%an%x01%ae%x01%ad%x01%s";
    let mut args = vec![
        "log".to_string(),
        format!("--format={format}"),
        "--date=iso".to_string(),
        format!("-n{limit}"),
        format!("--skip={skip}"),
    ];
    if let Some(file) = file {
        args.push("--".to_string());
        args.push(file.to_string());
    }
    git_success_with_owned(cwd, args, |stdout| {
        let history = stdout
            .lines()
            .filter_map(|line| {
                let parts = line.split('\u{1}').collect::<Vec<_>>();
                if parts.len() < 6 {
                    return None;
                }
                Some(json!({
                    "hash": parts[0],
                    "shortHash": parts[1],
                    "author": parts[2],
                    "email": parts[3],
                    "date": parts[4],
                    "subject": parts[5]
                }))
            })
            .collect::<Vec<_>>();
        json!({ "success": true, "history": history })
    })
}

fn git_list_branches(cwd: &str) -> Result<Value, String> {
    let current = git_output(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .stdout
        .trim()
        .to_string();
    git_success_with(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname)%01%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
        |stdout| {
            let branches = stdout
                .lines()
                .filter_map(|line| {
                    let parts = line.split('\u{1}').collect::<Vec<_>>();
                    if parts.len() != 2 {
                        return None;
                    }
                    let full = parts[0];
                    let short = parts[1];
                    Some(json!({
                        "name": short,
                        "fullName": full,
                        "type": if full.starts_with("refs/remotes/") { "remote" } else { "local" },
                        "isCurrent": short == current
                    }))
                })
                .collect::<Vec<_>>();
            json!({ "success": true, "branches": branches, "current": current })
        },
    )
}

fn scan_git_repositories(input: &Value) -> Result<Value, String> {
    let root = input
        .get("rootPath")
        .or_else(|| input.get("cwd"))
        .and_then(Value::as_str)
        .unwrap_or(".");
    let max_depth = input.get("maxDepth").and_then(Value::as_u64).unwrap_or(3) as usize;
    let root_path = PathBuf::from(root);
    let mut repos = Vec::new();
    scan_git_repositories_inner(&root_path, &root_path, 0, max_depth, &mut repos)?;
    Ok(json!({ "success": true, "repositories": repos }))
}

fn scan_git_repositories_inner(
    root: &Path,
    path: &Path,
    depth: usize,
    max_depth: usize,
    repos: &mut Vec<Value>,
) -> Result<(), String> {
    if path.join(".git").exists() {
        let branch = git_output(
            path.to_string_lossy().as_ref(),
            &["rev-parse", "--abbrev-ref", "HEAD"],
        )
        .ok()
        .filter(|output| output.code == 0)
        .map(|output| output.stdout.trim().to_string())
        .unwrap_or_default();
        repos.push(json!({
            "name": path.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
            "fullPath": path.to_string_lossy().to_string(),
            "relativePath": path.strip_prefix(root).unwrap_or(path).to_string_lossy().to_string(),
            "branch": branch,
            "isRootRepo": path == root
        }));
        return Ok(());
    }
    if depth >= max_depth || should_skip_dir(path) {
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .metadata()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            scan_git_repositories_inner(root, &entry.path(), depth + 1, max_depth, repos)?;
        }
    }
    Ok(())
}

fn git_path_command(cwd: &str, command_name: &str, input: &Value) -> Result<Value, String> {
    let paths = input
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "git path command requires paths".to_string())?;
    let mut args = vec![command_name.to_string(), "--".to_string()];
    args.extend(paths.iter().filter_map(Value::as_str).map(str::to_string));
    git_success_owned(cwd, args)
}

fn git_reset_paths(cwd: &str, input: &Value) -> Result<Value, String> {
    let paths = input
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "git reset requires paths".to_string())?;
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(paths.iter().filter_map(Value::as_str).map(str::to_string));
    git_success_owned(cwd, args)
}

fn git_discard(cwd: &str, input: &Value) -> Result<Value, String> {
    let paths = input
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| "git discard requires paths".to_string())?;
    let scope = input
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("worktree");
    let mut args = if scope == "untracked" {
        vec!["clean".to_string(), "-fd".to_string(), "--".to_string()]
    } else {
        vec!["checkout".to_string(), "--".to_string()]
    };
    args.extend(paths.iter().filter_map(Value::as_str).map(str::to_string));
    git_success_owned(cwd, args)
}

fn required_str<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing {key}"))
}

fn non_empty_lines(text: String) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn should_skip_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git")
            | Some("node_modules")
            | Some("dist")
            | Some("build")
            | Some("target")
            | Some(".next")
            | Some("coverage")
    )
}
