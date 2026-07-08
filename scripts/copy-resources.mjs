/**
 * Copies resources/ contents into the Tauri dev target directory,
 * replicating what `bundle.resources` does in production builds.
 *
 * In production, Tauri flattens `resources/` contents into the Resources/
 * directory: `resources/presets/` → `Resources/presets/`.
 *
 * In dev mode, `BaseDirectory::Resource` resolves to `target/debug/`,
 * so we mirror the same structure there.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const sourceDir = join(root, 'src-tauri', 'resources')
const devTargetDir = join(root, 'src-tauri', 'target', 'debug')

if (!existsSync(sourceDir)) {
  console.log('[copy-resources] No resources/ directory, skipping.')
  process.exit(0)
}

// Copy each item inside resources/ into target/debug/,
// matching Tauri's production bundle behavior (flattened, not nested).
let copied = 0
for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
  const src = join(sourceDir, entry.name)
  const dest = join(devTargetDir, entry.name)
  cpSync(src, dest, { recursive: true })
  copied++
}

console.log(`[copy-resources] Copied ${copied} item(s) from resources/ to ${devTargetDir}`)
