/**
 * Dist script — moves distributable files from target/release to dist/.
 *
 * Uses a blacklist to exclude build artifacts that should not be shipped.
 * Everything NOT blacklisted gets moved to the dist directory.
 */

import { existsSync, rmSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join, basename } from 'node:path'

// ---- blacklist ----

const BLACKLIST_DIRS = new Set([
  'deps',
  '.fingerprint',
  'build',
  'examples',
  'incremental',
  'nsis',
  'wix',
])

const BLACKLIST_EXTS = new Set([
  '.d',
  '.pdb',
  '.lib',
  '.exp',
  '.rmeta',
  '.rlib',
])

const BLACKLIST_FILES = new Set([
  '.cargo-lock',
  '.crates.toml',
  '.crates2.json',
  'CACHEDIR.TAG',
])

// ---- helpers ----

function shouldExclude(name) {
  if (BLACKLIST_DIRS.has(name)) return true
  if (BLACKLIST_FILES.has(name)) return true
  const dot = name.lastIndexOf('.')
  if (dot !== -1) {
    const ext = name.slice(dot)
    if (BLACKLIST_EXTS.has(ext)) return true
  }
  return false
}

function moveContents(srcDir, destDir) {
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true })
  }
  mkdirSync(destDir, { recursive: true })

  const entries = readdirSync(srcDir)
  const moved = []
  const skipped = []

  for (const entry of entries) {
    if (shouldExclude(entry)) {
      skipped.push(entry)
      continue
    }
    const src = join(srcDir, entry)
    const dest = join(destDir, entry)
    renameSync(src, dest)
    moved.push(entry)
  }

  return { moved, skipped }
}

// ---- main ----

const releaseDir = process.argv[2] || join(process.cwd(), 'src-tauri', 'target', 'release')
const distDir = process.argv[3] || join(process.cwd(), 'dist')

console.log('[dist] Moving distributable files...')
console.log(`[dist] Source: ${releaseDir}`)
console.log(`[dist] Dest:   ${distDir}`)

if (!existsSync(releaseDir)) {
  console.error(`[dist] ERROR: release dir not found: ${releaseDir}`)
  process.exit(1)
}

const { moved, skipped } = moveContents(releaseDir, distDir)

console.log(`[dist] Moved:   ${moved.join(', ') || '(none)'}`)
console.log(`[dist] Skipped: ${skipped.join(', ') || '(none)'}`)
console.log('[dist] Done.')
