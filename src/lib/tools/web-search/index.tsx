import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/lib/logger'
import { toolRegistry } from '../../agent/tool-registry'
import type { ToolHandler, ToolContext } from '../tool-types'
import type { ToolPanelContext } from '../tool-render-types'
import { encodeToolError, decodeStructuredToolResult } from '../tool-result-format'
import { ToolPanelLead, ToolIcon, Badge, OutputPre, LinkList, ErrorBlock, EmptyHint } from '@/components/chat/tool-panel/parts'
import { firstStringInput } from '@/components/chat/tool-panel/utils'
import {
  MAX_RESULTS_CAP,
  DEFAULT_MAX_RESULTS
} from './types'
import { runSearch, encodeSearchResult } from './orchestrator'
import { runFetch, encodeFetchResult } from './fetch-orchestrator'

const searchLog = createLogger('WebSearch')
const fetchLog = createLogger('WebFetch')

// --- WebSearch result parsing ---

interface WebSearchResult {
  title: string
  url: string
  content: string
}

function parseSearchResults(outputText: string | undefined): {
  results: WebSearchResult[]
  error?: string
} {
  if (!outputText?.trim()) return { results: [] }
  const decoded = decodeStructuredToolResult(outputText)
  if (!decoded) return { results: [] }
  if (!Array.isArray(decoded) && typeof decoded.error === 'string') {
    return { results: [], error: decoded.error }
  }
  const source = Array.isArray(decoded)
    ? decoded
    : Array.isArray((decoded as Record<string, unknown>).results)
      ? ((decoded as Record<string, unknown>).results as unknown[])
      : []
  const results = source
    .map((item): WebSearchResult | null => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title : ''
      const url = typeof obj.url === 'string' ? obj.url : ''
      const content = typeof obj.content === 'string' ? obj.content : ''
      if (!url) return null
      return { title: title || url, url, content }
    })
    .filter((r): r is WebSearchResult => !!r)
  return { results }
}

// --- WebSearch descriptor ---

function webSearchHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, displayName, t } = ctx
  const query = firstStringInput(input, ['query'])
  const { results } = parseSearchResults(outputText)
  const showCount = !!outputText
  return (
    <ToolPanelLead
      icon={<ToolIcon name="WebSearch" />}
      title={query || t('toolPanel.title.WebSearch')}
      subtitle={query ? t('toolPanel.title.WebSearch') : undefined}
      badges={
        showCount ? (
          <Badge tone={results.length > 0 ? 'green' : 'default'}>
            {t('toolCall.webSearch.resultCount', { count: results.length })}
          </Badge>
        ) : null
      }
      titleAttr={query || displayName}
    />
  )
}

function webSearchBody(ctx: ToolPanelContext): React.ReactNode {
  const { results, error } = parseSearchResults(ctx.outputText)
  if (error) {
    return <ErrorBlock text={error} />
  }
  return (
    <LinkList
      items={results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }))}
    />
  )
}

// --- WebFetch descriptor ---

interface FetchPayload {
  url: string
  content: string
  statusCode?: number
}

function parseFetchPayload(outputText: string | undefined): FetchPayload | null {
  if (!outputText?.trim()) return null
  const decoded = decodeStructuredToolResult(outputText)
  if (!decoded || Array.isArray(decoded)) return null
  const obj = decoded as Record<string, unknown>
  if (typeof obj.error === 'string') return { url: '', content: '' }
  return {
    url: typeof obj.url === 'string' ? obj.url : '',
    content: typeof obj.content === 'string' ? obj.content : '',
    statusCode: typeof obj.statusCode === 'number' ? obj.statusCode : undefined
  }
}

function webFetchHeader(ctx: ToolPanelContext): React.ReactNode {
  const { input, outputText, displayName, t } = ctx
  const url = firstStringInput(input, ['url'])
  const payload = parseFetchPayload(outputText)
  const badges: React.ReactNode[] = []
  if (payload?.statusCode !== undefined) {
    badges.push(
      <Badge key="status" tone={payload.statusCode < 400 ? 'green' : 'red'}>
        {String(payload.statusCode)}
      </Badge>
    )
  }
  if (payload?.content) {
    badges.push(<Badge key="chars" tone="blue">{t('toolCall.charCount', { count: payload.content.length })}</Badge>)
  }
  return (
    <ToolPanelLead
      icon={<ToolIcon name="WebFetch" />}
      title={url || t('toolPanel.title.WebFetch')}
      subtitle={url ? t('toolPanel.title.WebFetch') : undefined}
      badges={badges.length ? <>{badges}</> : null}
      titleAttr={url || displayName}
    />
  )
}

function WebFetchBody({ ctx }: { ctx: ToolPanelContext }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const payload = parseFetchPayload(ctx.outputText)
  if (!payload?.content) {
    return <EmptyHint ctx={ctx} />
  }
  return <OutputPre text={payload.content} maxHeightClass="max-h-80" />
}

function webFetchBody(ctx: ToolPanelContext): React.ReactNode {
  return <WebFetchBody ctx={ctx} />
}

// WebSearch Tool

const webSearchHandler: ToolHandler = {
  definition: {
    name: 'WebSearch',
    description:
      'Search the web for current information. Returns a list of results with titles, URLs, and content snippets. No API key or configuration required.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        maxResults: {
          type: 'number',
          description: `Maximum results to return (1-${MAX_RESULTS_CAP}, default ${DEFAULT_MAX_RESULTS})`,
          default: DEFAULT_MAX_RESULTS
        }
      },
      required: ['query']
    }
  },
  execute: async (input: Record<string, unknown>, ctx: ToolContext) => {
    const query = String(input.query ?? '').trim()
    if (!query) return encodeToolError('WebSearch requires a non-empty query')

    const maxResults = Math.min(
      Math.max(Number(input.maxResults) || DEFAULT_MAX_RESULTS, 1),
      MAX_RESULTS_CAP
    )

    searchLog.info(`Searching: ${query}`)
    const outcome = await runSearch(query, maxResults, ctx)

    if ('error' in outcome) return encodeToolError(`WebSearch failed: ${outcome.error}`)

    return encodeSearchResult(outcome.results, query, outcome.engine)
  },
  groups: ['web-search'],
  render: { kind: 'native-panel', renderHeader: webSearchHeader, renderBody: webSearchBody }
}

// WebFetch Tool

const webFetchHandler: ToolHandler = {
  definition: {
    name: 'WebFetch',
    description:
      'Fetch and extract readable text content from a URL. Use after WebSearch to read full page content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch'
        }
      },
      required: ['url']
    }
  },
  execute: async (input: Record<string, unknown>, ctx: ToolContext) => {
    const url = String(input.url ?? '').trim()
    if (!url) return encodeToolError('WebFetch requires a URL')

    fetchLog.info(`Fetching: ${url}`)
    const outcome = await runFetch(url, ctx)

    if ('error' in outcome) return encodeToolError(`WebFetch failed: ${outcome.error}`)

    return encodeFetchResult(url, outcome.result)
  },
  groups: ['web-search'],
  render: { kind: 'native-panel', renderHeader: webFetchHeader, renderBody: webFetchBody }
}

// Registration

export function registerWebSearchTools(): void {
  toolRegistry.add(webSearchHandler)
  toolRegistry.add(webFetchHandler)
}

export const webSearchToolModule: import('../tool-module').ToolModule = { register: registerWebSearchTools }
