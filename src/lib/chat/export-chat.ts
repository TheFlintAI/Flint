import type { ContentBlock } from '../api/types'
import type { Task } from '@/stores/chat/types'
import { getTotalTokens } from '@/lib/utils/format-tokens'
import { parseSystemCommandTag } from '../commands/system-command'
import { toonEncode } from '../tools/tool-result-format'

function formatTextContent(text: string): string {
  const parsed = parseSystemCommandTag(text)
  if (!parsed) return text

  const parts = [`**System Command: \`/${parsed.command.name}\`**`]
  if (parsed.command.content) {
    parts.push(parsed.command.content)
  }
  if (parsed.remainingText) {
    parts.push(parsed.remainingText)
  }
  return parts.join('\n\n')
}

function contentToMarkdown(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return formatTextContent(content)

  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return formatTextContent(block.text)
        case 'tool_use': {
          if (block.name === 'SpawnAgent') {
            const inp = block.input as Record<string, unknown>
            const subType = String(inp.agentName ?? '?')
            const desc = String(inp.description ?? inp.prompt ?? '')
            return `**🧠 Task: \`${subType}\`** — ${desc}`
          }
          return `**Tool Call: \`${block.name}\`**\n\`\`\`toon\n${toonEncode(block.input)}\n\`\`\``
        }
        case 'tool_result': {
          let contentStr: string
          if (Array.isArray(block.content)) {
            const parts = block.content.map((cb) =>
              cb.type === 'text'
                ? cb.text
                : cb.type === 'image'
                  ? `[Image: ${cb.source.mediaType}]`
                  : ''
            )
            contentStr = parts.join('\n') || '[Image]'
          } else {
            contentStr = block.content
          }
          return `**Tool Result** (${block.isError ? 'error' : 'success'}):\n\`\`\`\n${contentStr}\n\`\`\``
        }
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

export function taskToMarkdown(taskItem: Task): string {
  const lines: string[] = []
  lines.push(`# ${taskItem.title}`)
  lines.push('')
  lines.push(`- **Messages**: ${taskItem.messages.filter((m) => m.role !== 'system').length}`)
  lines.push(`- **Created**: ${new Date(taskItem.createdAt).toLocaleString()}`)
  lines.push(`- **Updated**: ${new Date(taskItem.updatedAt).toLocaleString()}`)
  if (taskItem.workingFolder) {
    lines.push(`- **Working Folder**: \`${taskItem.workingFolder}\``)
  }
  if (taskItem.pinned) {
    lines.push('- **Pinned**: Yes')
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of taskItem.messages) {
    if (msg.role === 'system') continue
    const label = msg.role === 'user' ? '## User' : '## Assistant'
    const time = new Date(msg.createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })
    lines.push(`${label} <sub>${time}</sub>`)
    lines.push('')
    lines.push(contentToMarkdown(msg.content))
    if (msg.usage) {
      lines.push('')
      const extras: string[] = []
      if (msg.usage.cacheReadTokens) extras.push(`${msg.usage.cacheReadTokens} cached`)
      if (msg.usage.reasoningTokens) extras.push(`${msg.usage.reasoningTokens} reasoning`)
      lines.push(
        `<sub>Tokens: ${msg.usage.inputTokens ?? 0} in / ${msg.usage.outputTokens} out${extras.length > 0 ? ` / ${extras.join(' / ')}` : ''}</sub>`
      )
    }
    lines.push('')
  }

  // Total token usage summary
  const totals = taskItem.messages.reduce(
    (acc, m) => {
      if (m.usage) {
        acc.input += m.usage.inputTokens ?? 0
        acc.output += m.usage.outputTokens
        if (m.usage.cacheReadTokens) acc.cacheRead += m.usage.cacheReadTokens
        if (m.usage.cacheCreationTokens) acc.cacheCreation += m.usage.cacheCreationTokens
        if (m.usage.reasoningTokens) acc.reasoning += m.usage.reasoningTokens
      }
      return acc
    },
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0 }
  )
  if (totals.input + totals.output > 0) {
    lines.push('---')
    lines.push('')
    const totalExtras: string[] = []
    if (totals.cacheRead > 0) totalExtras.push(`${totals.cacheRead} cache read`)
    if (totals.cacheCreation > 0) totalExtras.push(`${totals.cacheCreation} cache write`)
    if (totals.reasoning > 0) totalExtras.push(`${totals.reasoning} reasoning`)
    lines.push(
      `**Total tokens**: ${getTotalTokens(totals.input, totals.output)} (${totals.input} input + ${totals.output} output${totalExtras.length > 0 ? ` | ${totalExtras.join(', ')}` : ''})`
    )
    lines.push('')
  }

  return lines.join('\n')
}
