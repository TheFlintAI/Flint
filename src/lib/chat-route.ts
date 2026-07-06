import { settingsKvStore } from '@/services/tauri-api/command-storage'

export interface ChatRouteState {
  taskId: string | null
}

const DEFAULT_ROUTE: ChatRouteState = {
  taskId: null
}

const LAST_CHAT_ROUTE_SETTINGS_KEY = 'lastChatRoute'

function sanitizeChatRouteState(value: unknown): ChatRouteState | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Partial<ChatRouteState>
  const taskId =
    typeof candidate.taskId === 'string' && candidate.taskId ? candidate.taskId : null

  if (!taskId) return null

  return { taskId }
}

function normalizeHash(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const path = raw.trim()
  if (!path || path === '/') return '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function parseChatRoute(hash: string): ChatRouteState {
  const normalized = normalizeHash(hash)
  if (normalized === '/' || normalized === '/home') return DEFAULT_ROUTE

  const segments = normalized.split('/').filter(Boolean)
  if (segments[0] === 'chat') {
    const taskId = decodeURIComponent(segments[1] ?? '') || null
    return { taskId }
  }

  return DEFAULT_ROUTE
}

export function buildChatRoute(state: ChatRouteState): string {
  if (state.taskId) {
    return `#/chat/${encodeURIComponent(state.taskId)}`
  }

  return '#/'
}

export async function readPersistedChatRoute(): Promise<ChatRouteState | null> {
  await settingsKvStore.init()
  const value = settingsKvStore.get(LAST_CHAT_ROUTE_SETTINGS_KEY)
  return sanitizeChatRouteState(value)
}

export function persistChatRoute(state: ChatRouteState): void {
  settingsKvStore.set(LAST_CHAT_ROUTE_SETTINGS_KEY, {
    taskId: state.taskId
  })
}

export function replaceChatRoute(state: ChatRouteState): void {
  const nextHash = buildChatRoute(state)
  persistChatRoute(state)
  if (window.location.hash === nextHash) return
  window.history.replaceState(null, '', nextHash)
}
