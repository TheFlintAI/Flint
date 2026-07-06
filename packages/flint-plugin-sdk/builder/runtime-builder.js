/**
 * Shared runtime builder.
 *
 * Bundles the plugin runtime (transport, VNode factory, capabilities,
 * assembly) into a single minified + tree-shaken IIFE. This is loaded
 * once by the host and shared across all plugin Workers.
 *
 * Output: a single self-executing JS file that creates `globalThis.$plugin`.
 */

import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function buildRuntime(outputPath) {
  console.log('[flint-plugin] Building shared runtime...')

  const entry = join(__dirname, '..', 'runtime', 'index.js')

  const result = await Bun.build({
    entrypoints: [entry],
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
    throw new Error(`Runtime build failed:\n${errors}`)
  }

  const output = result.outputs[0]
  if (!output) {
    throw new Error('Runtime build produced no output')
  }

  const code = await output.text()
  await Bun.write(outputPath, code)

  const stats = await Bun.file(outputPath).stat()
  console.log(`  Output: ${outputPath}`)
  console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`)
  console.log('  Done.')
}
