import { invoke } from '@tauri-apps/api/core'
import { tauriCommands } from './command-client'

export type FlintRuntimeVersions = {
  tauri?: string
  webview?: string
  chrome?: string
}

export type HostPlatform = 'win32' | 'darwin' | 'linux' | string

export function getAppPlatform(): Promise<HostPlatform> {
  return invoke<HostPlatform>('app_platform')
}

export function getHostPlatform(): HostPlatform {
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('windows')) return 'win32'
  if (userAgent.includes('mac os') || userAgent.includes('macintosh')) return 'darwin'
  return 'linux'
}

export function getAppVersions(): Promise<FlintRuntimeVersions> {
  return invoke<FlintRuntimeVersions>('app_versions')
}

export function downloadImage(args: {
  url: string
  defaultName?: string
}): Promise<{ success?: boolean; canceled?: boolean; filePath?: string; error?: string }> {
  return tauriCommands.invoke('image:download', args)
}

export function fetchImageBase64(args: {
  url: string
}): Promise<{ data?: string; mimeType?: string; error?: string }> {
  return tauriCommands.invoke('image:fetch-base64', args)
}

export function writeImageToClipboard(args: {
  data: string
}): Promise<{ success?: boolean; error?: string }> {
  return tauriCommands.invoke('clipboard:write-image', args)
}
