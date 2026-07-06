/**
 * Silent project health check — compile-check + run all tests.
 *
 * Called after every task completion to catch regressions early.
 * Usage: bun run check   (or: bun scripts/check.mjs)
 *
 * Checks:
 *   1. Rust compilation  (cargo check)
 *   2. Rust tests        (cargo test)
 *   3. TypeScript types   (bun run typecheck)
 *
 * Output: one line per step; full output only on failure.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ── Helpers ──────────────────────────────────────────────────────────

const STATUS = { ok: '✓', fail: '✗', running: '·' }

function step(label) {
  process.stdout.write(`  ${STATUS.running} ${label}... `)
  return performance.now()
}

function done(start, ok, detail = '') {
  const ms = Math.round(performance.now() - start)
  const icon = ok ? STATUS.ok : STATUS.fail
  const timing = `${ms}ms`
  console.log(`${icon} ${timing}${detail ? '  ' + detail : ''}`)
}

async function run(cmd, args, opts = {}) {
  try {
    const result = await execFileAsync(cmd, args, {
      cwd: opts.cwd ?? root,
      timeout: opts.timeout ?? 300_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
      ...opts.extra,
    })
    return { ok: true, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? String(error),
      code: error.code,
    }
  }
}

// ── Steps ─────────────────────────────────────────────────────────────

async function checkRust() {
  const t0 = step('cargo check')
  const r = await run('cargo', ['check'], { cwd: join(root, 'src-tauri') })
  done(t0, r.ok)
  if (!r.ok) {
    console.log('\n' + (r.stderr || r.stdout))
  }
  return r.ok
}

async function testRust() {
  const t0 = step('cargo test')
  const r = await run('cargo', ['test'], {
    cwd: join(root, 'src-tauri'),
    timeout: 600_000,
  })
  // Extract actual test count from "test result: ok. 26 passed; ..."
  const testMatch = r.stdout.match(/^test result: ok\. (\d+) passed/m)
  const passed = testMatch ? parseInt(testMatch[1], 10) : 0
  const failedMatch = r.stdout.match(/^test result: FAILED\. (\d+) passed; (\d+) failed/m)
  const failed = failedMatch ? parseInt(failedMatch[2], 10) : 0
  const overallOk = r.ok && failed === 0
  const detail = overallOk ? `${passed} tests passed` : `${failed} tests failed`
  done(t0, overallOk, detail)
  if (!overallOk) {
    const lines = r.stdout.split('\n')
    const failures = lines.filter(l => l.includes('FAILED') || l.includes('failures:'))
    if (failures.length > 0) console.log(failures.join('\n'))
    if (r.stderr) console.log(r.stderr)
  }
  return overallOk
}

async function checkTypeScript() {
  const t0 = step('tsc --noEmit')
  const r = await run('bun', ['run', 'typecheck'], { cwd: root })
  done(t0, r.ok)
  if (!r.ok) {
    // Print only the error lines
    const lines = (r.stdout + r.stderr).split('\n').filter(l => l.trim())
    console.log(lines.slice(0, 30).join('\n'))
    if (lines.length > 30) console.log(`... and ${lines.length - 30} more lines`)
  }
  return r.ok
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\ncheck ──────────────────────────────────────────')
  const t0 = performance.now()

  // Run sequentially for clean interleaving-free output
  const rustCheckOk = await checkRust()
  const rustTestOk = await testRust()
  const tsOk = await checkTypeScript()

  const allOk = rustCheckOk && rustTestOk && tsOk
  const totalMs = Math.round(performance.now() - t0)

  if (allOk) {
    console.log(`  ${STATUS.ok} all good  (${totalMs}ms total)\n`)
  } else {
    const rustCheck = rustCheckOk ? '' : ' rust-check'
    const rustTest = rustTestOk ? '' : ' rust-test'
    const tsCheck = tsOk ? '' : ' ts-typecheck'
    const failed = [rustCheck, rustTest, tsCheck].filter(Boolean).join(',')
    console.log(`  ${STATUS.fail} failed:${failed}  (${totalMs}ms total)\n`)
    process.exitCode = 1
  }
}

main()
