use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};

pub struct FlpEntry {
    pub name: String,
    pub data: Vec<u8>,
}

/// Parses a FLP2 binary archive.
///
/// Magic: "8812FLP2" (8 bytes)
/// Binary layout:
///   Magic:   "8812FLP2" (8 bytes)
///   Count:   u32 LE
///   Per entry:
///     NameLen:  u16 LE
///     Name:     UTF-8 bytes
///     DataLen:  u32 LE
///     Data:     raw bytes
pub fn parse_flp(data: &[u8]) -> Result<Vec<FlpEntry>, String> {
    if data.len() < 12 {
        return Err("FLP file too short (minimum 12 bytes)".into());
    }

    let magic = &data[0..8];
    if magic != b"8812FLP2" {
        return Err(format!(
            "Invalid FLP magic: expected '8812FLP2', got '{:?}'",
            String::from_utf8_lossy(magic)
        ));
    }

    let mut cursor = Cursor::new(&data[8..]);
    let count = read_u32_le(&mut cursor)? as usize;

    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let name_len = read_u16_le(&mut cursor)? as usize;
        let name = read_string(&mut cursor, name_len)?;
        let data_len = read_u32_le(&mut cursor)? as usize;
        let entry_data = read_bytes(&mut cursor, data_len)?;

        entries.push(FlpEntry { name, data: entry_data });
    }

    Ok(entries)
}

pub fn get_entry_text(entries: &[FlpEntry], name: &str) -> Option<String> {
    entries
        .iter()
        .find(|e| e.name == name)
        .map(|e| String::from_utf8_lossy(&e.data).into_owned())
}

pub fn get_entry_bytes(entries: &[FlpEntry], name: &str) -> Option<Vec<u8>> {
    entries.iter().find(|e| e.name == name).map(|e| e.data.clone())
}

/// Decompress a gzipped entry. Returns the decompressed UTF-8 string.
pub fn gunzip_entry(entries: &[FlpEntry], name: &str) -> Option<String> {
    let data = get_entry_bytes(entries, name)?;
    let mut decoder = GzDecoder::new(&data[..]);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed).ok()?;
    Some(String::from_utf8_lossy(&decompressed).into_owned())
}

/// Extracts plugin source code from a FLP2 archive.
/// Reads and decompresses `plugin.js.gz`.
pub fn extract_plugin_js(entries: &[FlpEntry]) -> Result<String, String> {
    gunzip_entry(entries, "plugin.js.gz")
        .ok_or_else(|| "Missing plugin.js.gz in FLP archive".to_string())
}

/// Extracts the manifest from an FLP archive.
pub fn extract_manifest(entries: &[FlpEntry]) -> Result<String, String> {
    get_entry_text(entries, "manifest.toml")
        .ok_or_else(|| "Missing manifest.toml in FLP archive".to_string())
}

pub fn verify_checksum(entries: &[FlpEntry]) -> Result<bool, String> {
    let checksum_entry = entries.iter().find(|e| e.name == "checksum.sha256");
    let expected = match checksum_entry {
        Some(e) => String::from_utf8_lossy(&e.data).trim().to_string(),
        None => return Ok(true), // No checksum, skip
    };

    // Build deterministic input from sorted entry data (name + content)
    let mut content_parts: Vec<String> = entries
        .iter()
        .filter(|e| e.name != "checksum.sha256")
        .map(|e| format!("{}:{}\n{}", e.name, e.data.len(), hex::encode(sha256_hash(&e.data))))
        .collect();
    content_parts.sort();

    let checksum_input = content_parts.join("\n");
    let mut hasher = Sha256::new();
    hasher.update(checksum_input.as_bytes());
    let hash = hasher.finalize();
    let computed = format!("{:x}", hash);

    Ok(computed == expected)
}

fn sha256_hash(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

// ─── Binary reading helpers ───

fn read_u16_le(cursor: &mut Cursor<&[u8]>) -> Result<u16, String> {
    let mut buf = [0u8; 2];
    let pos = cursor.position() as usize;
    let data = cursor.get_ref();
    if pos + 2 > data.len() {
        return Err("FLP: unexpected EOF reading u16".into());
    }
    buf.copy_from_slice(&data[pos..pos + 2]);
    cursor.set_position((pos + 2) as u64);
    Ok(u16::from_le_bytes(buf))
}

fn read_u32_le(cursor: &mut Cursor<&[u8]>) -> Result<u32, String> {
    let mut buf = [0u8; 4];
    let pos = cursor.position() as usize;
    let data = cursor.get_ref();
    if pos + 4 > data.len() {
        return Err("FLP: unexpected EOF reading u32".into());
    }
    buf.copy_from_slice(&data[pos..pos + 4]);
    cursor.set_position((pos + 4) as u64);
    Ok(u32::from_le_bytes(buf))
}

fn read_string(cursor: &mut Cursor<&[u8]>, len: usize) -> Result<String, String> {
    let bytes = read_bytes(cursor, len)?;
    String::from_utf8(bytes).map_err(|e| format!("FLP: invalid UTF-8 in name: {}", e))
}

fn read_bytes(cursor: &mut Cursor<&[u8]>, len: usize) -> Result<Vec<u8>, String> {
    let pos = cursor.position() as usize;
    let data = cursor.get_ref();
    if pos + len > data.len() {
        return Err(format!(
            "FLP: unexpected EOF reading {} bytes at offset {}",
            len, pos
        ));
    }
    let bytes = data[pos..pos + len].to_vec();
    cursor.set_position((pos + len) as u64);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal FLP binary with the given entries (name → data).
    fn build_test_flp(magic: &[u8; 8], entries: &[(&str, &str)], include_checksum: bool) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        buf.extend_from_slice(magic);
        let count = if include_checksum { entries.len() + 1 } else { entries.len() } as u32;
        buf.extend_from_slice(&count.to_le_bytes());
        for (name, data) in entries {
            buf.extend_from_slice(&(name.len() as u16).to_le_bytes());
            buf.extend_from_slice(name.as_bytes());
            buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
            buf.extend_from_slice(data.as_bytes());
        }
        if include_checksum {
            let mut parts: Vec<String> = entries
                .iter()
                .map(|(name, data)| {
                    let data_hash = {
                        let mut hasher = Sha256::new();
                        hasher.update(data.as_bytes());
                        hex::encode(hasher.finalize())
                    };
                    format!("{name}:{}\n{data_hash}", data.len())
                })
                .collect();
            parts.sort();
            let input = parts.join("\n");
            let hash = {
                let mut hasher = Sha256::new();
                hasher.update(input.as_bytes());
                format!("{:x}", hasher.finalize())
            };
            let name = "checksum.sha256";
            buf.extend_from_slice(&(name.len() as u16).to_le_bytes());
            buf.extend_from_slice(name.as_bytes());
            buf.extend_from_slice(&(hash.len() as u32).to_le_bytes());
            buf.extend_from_slice(hash.as_bytes());
        }
        buf
    }

    #[test]
    fn test_parse_flp2() {
        let flp = build_test_flp(
            b"8812FLP2",
            &[
                ("manifest.toml", "[plugin]\nname = \"test\"\nversion = \"1.0.0\""),
                ("plugin.js.gz", "not-really-gzipped"),
            ],
            true,
        );
        let entries = parse_flp(&flp).expect("parse FLP2");
        assert_eq!(entries.len(), 3);
        assert!(verify_checksum(&entries).unwrap());
    }

    #[test]
    fn test_extract_manifest() {
        let manifest = "[plugin]\nname = \"test-plugin\"\nversion = \"2.0.0\"";
        let flp = build_test_flp(
            b"8812FLP2",
            &[("manifest.toml", manifest), ("plugin.js.gz", "code")],
            true,
        );
        let entries = parse_flp(&flp).expect("parse");
        let m = extract_manifest(&entries).expect("extract manifest");
        let parsed: toml::Value = toml::from_str(&m).unwrap();
        assert_eq!(parsed["plugin"]["name"].as_str(), Some("test-plugin"));
    }

    #[test]
    fn test_parse_invalid_magic() {
        let result = parse_flp(b"NOTFLP!!badmagic");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_too_short() {
        let result = parse_flp(b"FLP");
        assert!(result.is_err());
    }
}
