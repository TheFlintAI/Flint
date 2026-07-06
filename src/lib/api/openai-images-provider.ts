import type {
  APIProvider,
  ImageErrorCode,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
  UnifiedMessage,
  ContentBlock,
  ImageBlock
} from './types'
import {
  generateImagesFromText,
  streamImagesFromText,
  OpenAIImagesRequestError,
  type GeneratedImage
} from './openai-images'
import { registerProvider } from './provider'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { TAURI_COMMANDS } from '@/services/tauri-api/command-channels'
import { createLogger } from '@/lib/logger'

const log = createLogger('OpenAIImages')

function normalizeImageProviderError(error: unknown): { code: ImageErrorCode; message: string } {
  if (error instanceof OpenAIImagesRequestError) {
    return {
      code: error.code,
      message: error.message
    }
  }

  if (error instanceof TypeError) {
    return {
      code: 'network',
      message: `Network request failed while generating image. ${error.message}`
    }
  }

  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error)
  }
}

async function persistGeneratedImage(image: GeneratedImage): Promise<ImageBlock> {
  const fallback: ImageBlock = {
    type: 'image',
    source:
      image.sourceType === 'base64'
        ? { type: 'base64', mediaType: image.mediaType, data: image.data }
        : { type: 'url', url: image.data }
  }

  try {
    const result = (await tauriCommands.invoke(TAURI_COMMANDS.IMAGE_PERSIST_GENERATED, {
      ...(image.sourceType === 'base64'
        ? { data: image.data, mediaType: image.mediaType }
        : { url: image.data })
    })) as {
      filePath?: string
      mediaType?: string
      data?: string
      error?: string
    }

    if (result?.error || !result?.data) {
      if (result?.error) {
        log.warn('Failed to persist generated image:', result.error)
      }
      return fallback
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        mediaType: result.mediaType || image.mediaType || 'image/png',
        data: result.data,
        filePath: result.filePath
      }
    }
  } catch (error) {
    log.warn('Failed to persist generated image:', error)
    return fallback
  }
}

function createTransientImageBlock(image: GeneratedImage): ImageBlock {
  return {
    type: 'image',
    source:
      image.sourceType === 'base64'
        ? { type: 'base64', mediaType: image.mediaType, data: image.data }
        : { type: 'url', url: image.data }
  }
}

class OpenAIImagesProvider implements APIProvider {
  readonly name = 'OpenAI Images'
  readonly type = 'openai-images' as const

  async *sendMessage(
    messages: UnifiedMessage[],
    _tools: ToolDefinition[],
    config: ProviderConfig,
    signal?: AbortSignal
  ): AsyncIterable<StreamEvent> {
    const requestStartedAt = Date.now()
    let firstImageAt: number | null = null
    let lastPartialImage: GeneratedImage | null = null
    let emittedFinalImage = false

    log.debug('sendMessage called with config:', {
      type: config.type,
      model: config.model,
      baseUrl: config.baseUrl
    })

    try {
      yield { type: 'message_start' }

      // Extract the last user message
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMessage) {
        throw new Error('No user message found')
      }

      // Extract text prompt
      let textPrompt = ''

      if (typeof lastUserMessage.content === 'string') {
        textPrompt = lastUserMessage.content
      } else {
        const contentBlocks = lastUserMessage.content as ContentBlock[]
        for (const block of contentBlocks) {
          if (block.type === 'text') {
            textPrompt += block.text
          }
        }
      }

      if (!textPrompt.trim()) {
        throw new Error('No text prompt found for image generation')
      }

      if (config.imageGenerationStream?.enabled === true) {
        const stream = streamImagesFromText({
          config,
          prompt: textPrompt,
          signal
        })

        for await (const event of stream) {
          if (firstImageAt === null) firstImageAt = Date.now()
          if (event.kind === 'partial') {
            lastPartialImage = event.image
            yield {
              type: 'image_generation_partial',
              imageBlock: createTransientImageBlock(event.image),
              ...(typeof event.partialImageIndex === 'number'
                ? { partialImageIndex: event.partialImageIndex }
                : {})
            }
            continue
          }

          emittedFinalImage = true
          const imageBlock = await persistGeneratedImage(event.image)
          yield { type: 'image_generated', imageBlock }
        }

        const requestCompletedAt = Date.now()
        yield {
          type: 'message_end',
          stopReason: 'stop',
          timing: {
            totalMs: requestCompletedAt - requestStartedAt,
            ttftMs: firstImageAt
              ? firstImageAt - requestStartedAt
              : requestCompletedAt - requestStartedAt
          }
        }
        return
      }

      const results = await generateImagesFromText({
        config,
        prompt: textPrompt,
        signal
      })

      for (const img of results) {
        const imageBlock = await persistGeneratedImage(img)
        yield { type: 'image_generated', imageBlock }
      }

      // Yield completion event with image results
      const requestCompletedAt = Date.now()
      yield {
        type: 'message_end',
        stopReason: 'stop',
        timing: {
          totalMs: requestCompletedAt - requestStartedAt,
          ttftMs: requestCompletedAt - requestStartedAt
        }
      }
    } catch (error) {
      const normalizedError = normalizeImageProviderError(error)
      log.error('Provider error:', normalizedError.message, error)

      if (lastPartialImage && !emittedFinalImage && !signal?.aborted) {
        log.warn('Preserving last streamed preview after failure.')
        const imageBlock = await persistGeneratedImage(lastPartialImage)
        yield { type: 'image_generated', imageBlock }
      }

      // Yield a structured image error so UI can render a friendly card
      yield {
        type: 'image_error',
        imageError: {
          code: normalizedError.code,
          message: normalizedError.message
        }
      }

      const requestCompletedAt = Date.now()
      yield {
        type: 'message_end',
        stopReason: 'error',
        timing: {
          totalMs: requestCompletedAt - requestStartedAt,
          ttftMs: firstImageAt
            ? firstImageAt - requestStartedAt
            : requestCompletedAt - requestStartedAt
        }
      }

      return
    }
  }

  formatMessages(messages: UnifiedMessage[]): unknown {
    void messages
    return []
  }

  formatTools(tools: ToolDefinition[]): unknown {
    void tools
    return []
  }
}

export function registerOpenAIImagesProvider(): void {
  registerProvider('openai-images', () => new OpenAIImagesProvider())
}
