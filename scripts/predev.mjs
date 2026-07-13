import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEV_PORT = 5174
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

async function clearViteCache() {
  await Bun.$`rm -rf node_modules/.vite`.quiet()
}

function isPortError(error, code) {
  return error && typeof error === 'object' && 'code' in error && error.code === code
}

async function canBindPort(port) {
  const hosts = ['127.0.0.1', '::1']

  for (const host of hosts) {
    let server

    try {
      server = Bun.serve({
        hostname: host,
        port,
        fetch: () => new Response('ok')
      })
    } catch (error) {
      if (isPortError(error, 'EAFNOSUPPORT') || isPortError(error, 'EADDRNOTAVAIL')) {
        continue
      }

      if (isPortError(error, 'EADDRINUSE')) {
        return false
      }

      throw error
    } finally {
      server?.stop(true)
    }
  }

  return true
}

async function findWindowsPortProcesses(port) {
  const command = `
$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue
$ids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
$items = foreach ($id in $ids) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
  if ($process) {
    [pscustomobject]@{
      pid = [int]$process.ProcessId
      commandLine = [string]$process.CommandLine
      executablePath = [string]$process.ExecutablePath
    }
  }
}
$items | ConvertTo-Json -Compress
`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command])
  return parseProcessList(stdout)
}

async function findUnixPortProcesses(port) {
  const command = `
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:${port} -sTCP:LISTEN -Fpca
fi
`
  const { stdout } = await execFileAsync('sh', ['-lc', command])
  const processes = []
  let current

  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      current = { pid: Number(line.slice(1)), commandLine: '', executablePath: '' }
      processes.push(current)
    } else if (current && line.startsWith('c')) {
      current.executablePath = line.slice(1)
    } else if (current && line.startsWith('a')) {
      current.commandLine = line.slice(1)
    }
  }

  return processes.filter((processInfo) => Number.isInteger(processInfo.pid))
}

async function findPortProcesses(port) {
  try {
    return process.platform === 'win32'
      ? await findWindowsPortProcesses(port)
      : await findUnixPortProcesses(port)
  } catch {
    return []
  }
}

function parseProcessList(stdout) {
  const trimmed = stdout.trim()

  if (!trimmed) {
    return []
  }

  const data = JSON.parse(trimmed)
  return Array.isArray(data) ? data : [data]
}

function isProjectDevProcess(processInfo) {
  if (!processInfo || processInfo.pid === process.pid) {
    return false
  }

  const commandLine = String(processInfo.commandLine ?? '').toLowerCase()
  const executablePath = String(processInfo.executablePath ?? '').toLowerCase()
  const projectRoot = decodeURIComponent(PROJECT_ROOT).replace(/\\/g, '/').toLowerCase()
  const normalizedCommand = commandLine.replace(/\\/g, '/')

  return (
    normalizedCommand.includes(projectRoot) &&
    (commandLine.includes('vite') ||
      commandLine.includes('bun') ||
      executablePath.includes('node') ||
      executablePath.includes('bun'))
  )
}

async function stopProcess(processInfo) {
  try {
    process.kill(processInfo.pid)
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await canBindPort(port)) {
      return true
    }

    await Bun.sleep(100)
  }

  return false
}

async function freeDevPort(port) {
  if (await canBindPort(port)) {
    return
  }

  const processes = await findPortProcesses(port)
  const devProcesses = processes.filter(isProjectDevProcess)

  if (devProcesses.length === 0) {
    const details = processes
      .map((processInfo) => `${processInfo.pid}: ${processInfo.commandLine || processInfo.executablePath}`)
      .join('\n')

    throw new Error(
      `Port ${port} is already in use by a process that does not look like Flint's dev server.` +
        (details ? `\n${details}` : '')
    )
  }

  for (const processInfo of devProcesses) {
    console.log(`Stopping stale Flint dev server on port ${port} (pid ${processInfo.pid})`)
    await stopProcess(processInfo)
  }

  if (!(await waitForPort(port))) {
    throw new Error(`Port ${port} is still in use after stopping the stale dev server.`)
  }
}

async function main() {
  // Sync version from package.json before every dev run
  await Bun.$`bun run ${join(PROJECT_ROOT, 'scripts', 'sync-version.mjs')}`.quiet()
  await clearViteCache()
  await freeDevPort(DEV_PORT)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
