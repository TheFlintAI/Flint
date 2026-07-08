/**
 * Builds the shared plugin runtime + all built-in plugins into Tauri resources.
 *
 * Output target: src-tauri/resources/plugins/ — Tauri bundle.resources reads from here.
 */

import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const sourceDir = join(root, 'plugins')
const resourcePluginDir = join(root, 'src-tauri', 'resources', 'plugins')
const sdkCli = join(root, 'packages', 'flint-plugin-sdk', 'cli.js')

function runCli(args) {
  const proc = Bun.spawnSync(['bun', 'run', sdkCli, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  if (proc.exitCode !== 0) {
    console.error(proc.stderr.toString())
    process.exit(1)
  }
}

async function main() {
  mkdirSync(resourcePluginDir, { recursive: true })

  // ── Shared runtime ────────────────────────────────────────────────────
  console.log('[build-plugins] Building shared runtime...')
  const runtimeOutput = join(resourcePluginDir, 'runtime.js')
  runCli(['build-runtime', runtimeOutput])
  console.log(`  -> ${runtimeOutput}`)

  // ── Plugins ───────────────────────────────────────────────────────────
  if (!existsSync(sourceDir)) {
    console.log('[build-plugins] No plugins/ directory, skipping plugins.')
    return
  }

  const names = readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  if (names.length === 0) {
    console.log('[build-plugins] No plugins found, skipping.')
    return
  }

  console.log(`[build-plugins] Building ${names.length} plugin(s)...`)

  for (const name of names) {
    const source = join(sourceDir, name)
    const output = join(resourcePluginDir, `${name}.flp`)

    if (!existsSync(join(source, 'plugin.toml'))) {
      console.warn(`  - Skipping ${name}: no plugin.toml`)
      continue
    }

    console.log(`  - Building ${name}...`)
    runCli(['build', source, output])
    console.log(`    -> ${output}`)
  }

  console.log(`[build-plugins] Done — runtime + ${names.length} plugin(s) staged to resources`)
}

main().catch((err) => {
  console.error('[build-plugins]', err.message)
  process.exit(1)
})
