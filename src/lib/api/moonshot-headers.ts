import { tauriCommands } from '@/services/tauri-api/command-client'

const KIMI_CLIENT_VERSION = '1.30.0'

function randomHex(bytes = 16): string {
  const buffer = new Uint8Array(bytes)
  window.crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('')
}

function toAsciiHeaderValue(value: string | undefined | null, fallback = 'unknown'): string {
  if (!value) return fallback
  const ascii = Array.from(value)
    .filter((char) => char.charCodeAt(0) <= 0x7f)
    .join('')
    .trim()
  return ascii || fallback
}

function normalizeMoonshotArch(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return 'Unknown'
  if (normalized === 'x64') return 'X64'
  if (normalized === 'arm64') return 'Arm64'
  if (normalized === 'x86' || normalized === 'ia32') return 'X86'
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function buildMoonshotDeviceModel(info: { platform?: string; arch?: string; release?: string }): string {
  const platform = info.platform?.trim().toLowerCase()
  const arch = normalizeMoonshotArch(info.arch)
  const release = info.release?.trim()

  if (platform === 'win32') {
    const build = Number(release?.split('.').pop() ?? '')
    const version = Number.isFinite(build) && build >= 22000 ? '11' : '10'
    return `Windows ${version} ${arch}`
  }

  if (platform === 'darwin') {
    return `macOS ${release || 'unknown'} ${arch}`
  }

  const description = [platform, release].filter(Boolean).join(' ').trim() || 'Unknown'
  return `${description} ${arch}`.trim()
}

interface AppSystemInfoPayload {
  machineName?: string
  platform?: string
  arch?: string
  release?: string
}

let appSystemInfoPromise: Promise<AppSystemInfoPayload> | null = null

async function getAppSystemInfo(): Promise<AppSystemInfoPayload> {
  if (!appSystemInfoPromise) {
    appSystemInfoPromise = (async () => {
      try {
        const result = (await tauriCommands.invoke(
          'app:system-info'
        )) as AppSystemInfoPayload | null
        if (result && typeof result === 'object') {
          return result
        }
      } catch {
        // Ignore failures and fall back to frontend-visible values.
      }

      const platform = /mac/i.test(navigator.platform)
        ? 'darwin'
        : /win/i.test(navigator.platform)
          ? 'win32'
          : navigator.platform.toLowerCase() || undefined

      return { platform }
    })()
  }

  return appSystemInfoPromise
}

export function isMoonshotProviderConfig(config: {
  providerBuiltinId?: string
  baseUrl?: string
}): boolean {
  if (config.providerBuiltinId === 'moonshot-coding') return true
  return /https?:\/\/api\.kimi\.com\/coding/i.test((config.baseUrl ?? '').trim())
}

export async function buildMoonshotCommonHeaders(
  deviceId?: string
): Promise<Record<string, string>> {
  const systemInfo = await getAppSystemInfo()

  return {
    'X-Msh-Platform': 'kimi_cli',
    'X-Msh-Version': KIMI_CLIENT_VERSION,
    'X-Msh-Device-Name': toAsciiHeaderValue(systemInfo.machineName),
    'X-Msh-Device-Model': toAsciiHeaderValue(buildMoonshotDeviceModel(systemInfo)),
    'X-Msh-Os-Version': toAsciiHeaderValue(systemInfo.release),
    'X-Msh-Device-Id': deviceId?.trim() || randomHex(16)
  }
}
