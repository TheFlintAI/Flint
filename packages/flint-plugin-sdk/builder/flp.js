/**
 * FLP v2 archive format — self-contained plugin package.
 *
 * Binary layout:
 *   Magic: "8812FLP2" (8 bytes)
 *   Count: uint32 LE
 *   Per entry:
 *     NameLen  uint16 LE
 *     Name     UTF-8
 *     DataLen  uint32 LE
 *     Data     raw bytes (gzipped for plugin.js.gz)
 */

import { gzipSync } from 'bun'

export async function createFlp(manifestToml, pluginJs, outputPath) {
  const encoder = new TextEncoder()

  // Gzip the plugin code
  const pluginJsBytes = encoder.encode(pluginJs)
  const compressed = gzipSync(pluginJsBytes)

  const entries = []

  entries.push({ name: 'manifest.toml', content: encoder.encode(manifestToml) })
  entries.push({ name: 'plugin.js.gz', content: Buffer.from(compressed) })

  // SHA-256 checksum over entry content (name + size + content hash)
  const checksumParts = await Promise.all(entries.map(async e => {
    const contentHash = await crypto.subtle.digest('SHA-256', e.content)
    const hashHex = Array.from(new Uint8Array(contentHash)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `${e.name}:${e.content.length}\n${hashHex}`
  }))
  checksumParts.sort()
  const checksumInput = checksumParts.join('\n')
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(checksumInput))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const checksum = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  entries.push({ name: 'checksum.sha256', content: encoder.encode(checksum) })

  // Serialize
  let totalSize = 8 + 4 // magic + count
  for (const entry of entries) {
    totalSize += 2 + encoder.encode(entry.name).length + 4 + entry.content.length
  }

  const buffer = new Uint8Array(totalSize)
  const view = new DataView(buffer.buffer)
  let offset = 0

  // Magic: 8812FLP2
  buffer[offset++] = 0x38 // 8
  buffer[offset++] = 0x38 // 8
  buffer[offset++] = 0x31 // 1
  buffer[offset++] = 0x32 // 2
  buffer[offset++] = 0x46 // F
  buffer[offset++] = 0x4c // L
  buffer[offset++] = 0x50 // P
  buffer[offset++] = 0x32 // 2

  // Count
  view.setUint32(offset, entries.length, true)
  offset += 4

  // Entries
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    view.setUint16(offset, nameBytes.length, true)
    offset += 2
    buffer.set(nameBytes, offset)
    offset += nameBytes.length
    view.setUint32(offset, entry.content.length, true)
    offset += 4
    buffer.set(entry.content, offset)
    offset += entry.content.length
  }

  await Bun.write(outputPath, buffer)
}
