import type {
  ToolDefinition,
  ProviderConfig
} from '../types'
import { buildResponsesImageGenerationTool } from '../responses-image-generation'

/**
 * Sanitize a JSON Schema tree for third-party provider compatibility.
 * Strips metadata/constraint keywords that many providers reject.
 */
export function sanitizeSchemaForCompat(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'additionalProperties' && value === false) continue
    if (key === 'default' || key === 'examples' || key === 'const') continue
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const cleaned: Record<string, unknown> = {}
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        cleaned[propKey] =
          propVal && typeof propVal === 'object' && !Array.isArray(propVal)
            ? sanitizeSchemaForCompat(propVal as Record<string, unknown>)
            : propVal
      }
      result[key] = cleaned
    } else {
      result[key] = value
    }
  }
  return result
}

export function normalizeToolSchema(
  schema: ToolDefinition['inputSchema'],
  supportsStrictSchemas?: boolean
): Record<string, unknown> {
  if ('properties' in schema) {
    if (supportsStrictSchemas) return schema as Record<string, unknown>
    return sanitizeSchemaForCompat(schema as Record<string, unknown>)
  }

  const mergedProperties: Record<string, unknown> = {}
  let requiredIntersection: string[] | null = null

  for (const variant of schema.oneOf) {
    for (const [key, value] of Object.entries(variant.properties ?? {})) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = supportsStrictSchemas
          ? value
          : value && typeof value === 'object' && !Array.isArray(value)
            ? sanitizeSchemaForCompat(value as Record<string, unknown>)
            : value
      }
    }

    const required = variant.required ?? []
    if (requiredIntersection === null) {
      requiredIntersection = [...required]
    } else {
      requiredIntersection = requiredIntersection.filter((key) => required.includes(key))
    }
  }

  const normalized: Record<string, unknown> = {
    type: 'object',
    properties: mergedProperties
  }

  if (supportsStrictSchemas) {
    normalized.additionalProperties = false
  }

  if (requiredIntersection && requiredIntersection.length > 0) {
    normalized.required = requiredIntersection
  }

  return normalized
}

export function formatTools(tools: ToolDefinition[], supportsStrictSchemas?: boolean): unknown[] {
  return tools.map((t) => {
    if (typeof t.description !== 'string') {
      throw new Error(
        `[OpenAI] Tool "${t.name}" has non-string description ` +
        `(type=${typeof t.description}). This must be resolved before reaching formatTools.`
      )
    }
    return {
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: normalizeToolSchema(t.inputSchema, supportsStrictSchemas),
      strict: false
    }
  })
}

export function buildToolsPayload(tools: ToolDefinition[], config: ProviderConfig): unknown[] {
  const formattedTools = formatTools(tools, config.supportsStrictSchemas)
  const responsesImageGeneration = config.imageGenerationStream
    ? {
        ...(config.responsesImageGeneration ?? {}),
        partialImages:
          config.imageGenerationStream.enabled === true
            ? (config.imageGenerationStream.partialImages ?? 2)
            : 0
      }
    : config.responsesImageGeneration
  const imageGenerationTool = buildResponsesImageGenerationTool(responsesImageGeneration)
  const specialTools: unknown[] = []
  if (config.computerUseEnabled) {
    specialTools.push({ type: 'computer' })
  }
  if (imageGenerationTool) {
    specialTools.push(imageGenerationTool)
  }
  return [...specialTools, ...formattedTools]
}
