use std::io::Read;
use std::path::Path;

/// Fast binary file detection by inspecting the first 8KB of content.
/// Returns `true` if the file contains null bytes (binary data).
///
/// Also rejects files larger than 10MB — searching them line-by-line is
/// too slow and they are almost certainly not source code.
pub(crate) fn is_text_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    if metadata.len() == 0 {
        return true;
    }
    if metadata.len() > 10 * 1024 * 1024 {
        return false;
    }

    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut buf = [0u8; 8192];
    let Ok(n) = file.read(&mut buf) else {
        return false;
    };

    !buf[..n].contains(&0)
}
