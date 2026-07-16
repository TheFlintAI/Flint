use std::path::{Path, PathBuf};

use glob::Pattern;

/// Walks a directory tree, respecting `.gitignore` rules and skipping
 /// known large/binary directories. Applies optional include/exclude glob
/// filters on each file's path relative to the search root.
pub(crate) fn walk_search_files<'a>(
    root: &'a Path,
    include: Option<&'a Pattern>,
    exclude: Option<&'a Pattern>,
) -> impl Iterator<Item = PathBuf> + 'a {
    ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(false)
        .require_git(false)
        .filter_entry(move |entry| !skip_heavy_dir(entry.path()))
        .build()
        .filter_map(|entry| entry.ok().map(|e| e.into_path()))
        .filter(move |path| match_path_filters(path, root, include, exclude))
}

/// Directories that are always skipped regardless of `.gitignore` status.
/// These are build/dependency directories that contain no useful search
/// content and would waste significant time to traverse.
fn skip_heavy_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| {
            matches!(name, "node_modules" | "target" | "dist" | "build" | ".next" | "coverage")
        })
}

/// Apply include/exclude glob patterns to a file path.
/// The path is normalized to use forward slashes before matching.
fn match_path_filters(
    path: &Path,
    root: &Path,
    include: Option<&Pattern>,
    exclude: Option<&Pattern>,
) -> bool {
    if !path.is_file() {
        return false;
    }

    let relative = path.strip_prefix(root).unwrap_or(path);
    let normalized = relative.to_string_lossy().replace('\\', "/");

    if exclude.is_some_and(|pat| pat.matches(&normalized)) {
        return false;
    }

    include.map_or(true, |pat| pat.matches(&normalized))
}
