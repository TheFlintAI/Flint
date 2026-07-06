import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'

const promptCache = new Map<string, string>()

export async function loadPrompt(name: string): Promise<string | null> {
  const key = name.trim()
  if (!key) return null

  const cached = promptCache.get(key)
  if (cached) return cached

  try {
    const result = (await tauriCommands.invoke(TAURI_COMMANDS.PROMPTS_LOAD, { name: key })) as
      | { content?: string; error?: string }
      | undefined

    if (result && typeof result === 'object' && typeof result.content === 'string') {
      promptCache.set(key, result.content)
      return result.content
    }
  } catch {
    // ignore prompt load failures
  }

  return null
}

export function clearPromptCache(): void {
  promptCache.clear()
}
