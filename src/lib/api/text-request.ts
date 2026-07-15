import { createProvider } from '@/lib/api/provider'
import type { ProviderConfig, UnifiedMessage } from '@/lib/api/types'

export async function runTextRequest(args: {
  provider: ProviderConfig
  messages: UnifiedMessage[]
  signal?: AbortSignal
  onChunk?: (text: string) => void
}): Promise<string> {
  const api = createProvider(args.provider)
  let text = ''
  for await (const event of api.sendMessage(args.messages, [], args.provider, args.signal)) {
    if (event.type === 'text_delta') {
      const chunk = event.text ?? ''
      text += chunk
      args.onChunk?.(chunk)
    }
    if (event.type === 'error') {
      throw new Error(event.error?.message ?? 'Provider request failed')
    }
  }
  return text
}
