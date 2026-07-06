/**
 * Plugin build pipeline:
 *   1. Read plugin.toml from source directory
 *   2. Validate manifest
 *   3. Bun.build() the plugin entry (TypeScript → minified + tree-shaken JS)
 *   4. Package into .flp v2 binary with gzip compression
 *
 * The runtime is built separately via buildRuntime() and shared across all
 * plugins. Plugin code references `$plugin` as a global provided by the
 * shared runtime.
 */

import { join } from 'path'
import { validateManifest } from './validate.js'
import { createFlp } from './flp.js'

// ── Manifest reading ───────────────────────────────────────────────────────

async function readManifest(sourceDir) {
  const manifestPath = join(sourceDir, 'plugin.toml')
  let manifestToml
  try {
    manifestToml = await Bun.file(manifestPath).text()
  } catch {
    throw new Error(`plugin.toml not found in ${sourceDir}`)
  }

  let manifest
  try {
    manifest = Bun.TOML.parse(manifestToml)
  } catch (err) {
    throw new Error(`Failed to parse plugin.toml: ${err instanceof Error ? err.message : String(err)}`)
  }

  validateManifest(manifest)

  const mainFile = manifest.main || 'main.ts'
  const mainPath = join(sourceDir, mainFile)
  if (!(await Bun.file(mainPath).exists())) {
    throw new Error(`Entry point not found: ${mainFile}`)
  }

  return { manifest, manifestToml, mainPath, mainFile }
}

// ── Plugin code build ──────────────────────────────────────────────────────

async function buildPluginJs(mainPath) {
  const result = await Bun.build({
    entrypoints: [mainPath],
    target: 'browser',
    format: 'iife',
    minify: {
      whitespace: true,
      identifiers: true,
      syntax: true,
    },
    treeShaking: true,
  })

  if (!result.success) {
    const errors = result.logs
      .filter(l => l.level === 'error')
      .map(l => l.message)
      .join('\n')
    throw new Error(`Build failed:\n${errors}`)
  }

  const output = result.outputs[0]
  if (!output) {
    throw new Error('Build produced no output')
  }

  return output.text()
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function buildPlugin(sourceDir, outputPath) {
  console.log(`[flint-plugin] Building from ${sourceDir}`)

  const { manifest, manifestToml, mainPath } = await readManifest(sourceDir)
  const name = typeof manifest.name === 'string' ? manifest.name : 'unknown'
  const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  const displayName = (manifest.displayName && typeof manifest.displayName === 'object')
    ? (manifest.displayName.en || Object.values(manifest.displayName)[0] || name)
    : name

  console.log(`  Plugin: ${displayName} v${version}`)

  const pluginJs = await buildPluginJs(mainPath)
  await createFlp(manifestToml, pluginJs, outputPath)

  const stats = await Bun.file(outputPath).stat()
  console.log(`  Output: ${outputPath}`)
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`)
  console.log('  Done.')
}

export async function validatePlugin(sourceDir) {
  const { manifest, mainFile } = await readManifest(sourceDir)
  console.log('✓ plugin.toml is valid')
  console.log(`✓ Plugin: ${JSON.stringify(manifest.displayName)} v${manifest.version}`)
  console.log(`✓ Entry: ${mainFile}`)
}
