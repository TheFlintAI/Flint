/**
 * Downloads provider icons from @lobehub/icons-static-png into public/icons/providers/.
 *
 * Primary: downloads via npm (with npmmirror registry, faster in China).
 * Fallback: direct CDN download from unpkg.
 *
 * Usage: bun run scripts/download-provider-icons.mjs
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'public', 'icons', 'providers')
const tmpDir = join(root, '.tmp-icons')

const PACKAGE = '@lobehub/icons-static-png@1.83.0'
const REGISTRY = 'https://registry.npmmirror.com'

// All unique icon slugs used in provider-icons.tsx
const SLUGS = [
  'anthropic',
  'azureai',
  'baidu',
  'chatglm',
  'claude',
  'deepseek',
  'doubao',
  'gemini',
  'github',
  'google',
  'grok',
  'hunyuan',
  'kimi',
  'meta',
  'minimax',
  'mistral',
  'moonshot',
  'nvidia',
  'ollama',
  'openai',
  'openrouter',
  'qwen',
  'siliconcloud',
  'stepfun',
  'xiaomimimo',
]

// Slugs that use "{slug}-color.png" instead of "{slug}.png"
const COLOR_SLUGS = new Set([
  'azureai', 'baidu', 'chatglm', 'claude', 'deepseek', 'doubao',
  'gemini', 'google', 'hunyuan', 'kimi', 'meta', 'minimax',
  'mistral', 'nvidia', 'qwen', 'siliconcloud', 'stepfun',
])

function fileName(slug) {
  return COLOR_SLUGS.has(slug) ? `${slug}-color.png` : `${slug}.png`
}

async function downloadViaCdn(slug) {
  const file = fileName(slug)
  // Try multiple CDNs
  const urls = [
    `https://registry.npmmirror.com/@lobehub/icons-static-png/1.83.0/files/dark/${file}`,
    `https://unpkg.com/${PACKAGE}/dark/${file}`,
    `https://cdn.jsdelivr.net/npm/${PACKAGE}/dark/${file}`,
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer())
      }
    } catch {
      continue
    }
  }
  return null
}

async function main() {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  console.log(`Downloading ${SLUGS.length} provider icons to ${outDir}...\n`)

  // Try npm pack first (most reliable)
  let extractedDir = null
  try {
    mkdirSync(tmpDir, { recursive: true })
    console.log(`  Downloading ${PACKAGE} via npm...`)
    execSync(`npm pack ${PACKAGE} --registry=${REGISTRY} --pack-destination "${tmpDir}"`, {
      cwd: root,
      stdio: 'pipe',
    })
    const tgzFiles = require('fs').readdirSync(tmpDir).filter(f => f.endsWith('.tgz'))
    if (tgzFiles.length > 0) {
      execSync(`tar -xzf "${join(tmpDir, tgzFiles[0])}" -C "${tmpDir}"`, { cwd: root, stdio: 'pipe' })
      extractedDir = join(tmpDir, 'package', 'dark')
    }
  } catch (err) {
    console.log(`  npm download failed, will try CDN fallback: ${err.message}`)
  }

  let ok = 0
  let fail = 0

  for (const slug of SLUGS) {
    const file = fileName(slug)
    const dest = join(outDir, file)

    if (existsSync(dest)) {
      console.log(`  · ${file} (cached)`)
      ok++
      continue
    }

    let buffer = null

    // Try local extracted package first
    if (extractedDir && existsSync(join(extractedDir, file))) {
      buffer = require('fs').readFileSync(join(extractedDir, file))
    }

    // Fallback to CDN
    if (!buffer) {
      process.stdout.write(`  ↓ ${file}...`)
      buffer = await downloadViaCdn(slug)
    }

    if (buffer) {
      require('fs').writeFileSync(dest, buffer)
      console.log(` done`)
      ok++
    } else {
      console.error(` FAILED`)
      fail++
    }
  }

  // Cleanup
  try { rmSync(tmpDir, { recursive: true }) } catch {}

  console.log(`\nDone: ${ok} icons, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
