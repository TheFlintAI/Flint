/**
 * Sync version from package.json to tauri.conf.json and Cargo.toml.
 *
 * package.json is the single source of truth for the app version.
 * This script reads it and writes the version into the two files
 * that also need it, keeping everything in sync automatically.
 *
 * Called by predev.mjs and build.mjs — no manual invocation needed.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version

if (!version || typeof version !== 'string') {
  console.error('[sync-version] ERROR: package.json is missing a valid version field')
  process.exit(1)
}

console.log(`[sync-version] Syncing version from package.json: ${version}`)

// --- tauri.conf.json ---
const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json')
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'))
if (tauriConf.version !== version) {
  tauriConf.version = version
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n')
  console.log(`[sync-version] tauri.conf.json: ${tauriConf.version} → ${version}`)
} else {
  console.log(`[sync-version] tauri.conf.json: ${version} (unchanged)`)
}

// --- Cargo.toml ---
const cargoPath = join(root, 'src-tauri', 'Cargo.toml')
let cargo = readFileSync(cargoPath, 'utf-8')
const versionRegex = /^version\s*=\s*"[^"]*"/m
const oldCargoVersion = cargo.match(versionRegex)?.[0]?.match(/"[^"]*"/)?.[0]?.replace(/"/g, '') ?? '?'
const newCargo = cargo.replace(versionRegex, `version = "${version}"`)
if (newCargo !== cargo) {
  writeFileSync(cargoPath, newCargo)
  console.log(`[sync-version] Cargo.toml: ${oldCargoVersion} → ${version}`)
} else {
  console.log(`[sync-version] Cargo.toml: ${version} (unchanged)`)
}

console.log(`[sync-version] Done`)
