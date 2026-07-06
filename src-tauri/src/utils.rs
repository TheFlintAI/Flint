use std::env;
use std::path::{Path, PathBuf};

pub(crate) fn home_dir_string() -> String {
    home_dir().to_string_lossy().to_string()
}

pub(crate) fn home_dir() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home);
    }
    if let Some(profile) = env::var_os("USERPROFILE") {
        return PathBuf::from(profile);
    }
    PathBuf::from(".")
}

/// Flint data directory: `~/.flint/`
pub(crate) fn flint_dir() -> PathBuf {
    home_dir().join(".flint")
}

/// Resolve a path under the Flint data directory.
pub(crate) fn flint_path(relative: impl AsRef<Path>) -> PathBuf {
    flint_dir().join(relative)
}
