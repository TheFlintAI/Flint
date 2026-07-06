/**
 * Typed wrapper around the Tauri command client for plugin operations.
 */

import { tauriCommands } from '@/services/tauri-api/command-client'

export async function invokePlugin<T = unknown>(
  channel: string,
  args?: Record<string, unknown>
): Promise<T> {
  return tauriCommands.invoke<T>(channel, args)
}
