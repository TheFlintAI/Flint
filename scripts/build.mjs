/**
 * Build script.
 *
 * Usage:
 *   bun run build         → tauri build          (with bundle)
 *   bun run build:no-bundle → tauri build --no-bundle
 */

import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const args = process.argv.slice(2)

// Step 1: sync version from package.json
console.log('[build] sync-version...')
execFileSync('bun', ['run', join(root, 'scripts', 'sync-version.mjs')], { cwd: root, stdio: 'inherit' })

// Step 2: typecheck
console.log('[build] typecheck...')
execFileSync('bun', ['run', 'typecheck'], { cwd: root, stdio: 'inherit' })

// Step 2: tauri build
const tauriArgs = ['build', ...args]
console.log(`[build] tauri ${tauriArgs.join(' ')}`)
execFileSync('tauri', tauriArgs, { cwd: join(root, 'src-tauri'), stdio: 'inherit' })

// Step 3: move distributable files to dist/
console.log('[build] dist...')
execFileSync('bun', ['run', join(root, 'scripts', 'dist.mjs')], { cwd: root, stdio: 'inherit' })
