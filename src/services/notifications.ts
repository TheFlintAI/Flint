/**
 * Cross-platform notification service wrapping @tauri-apps/plugin-notification.
 *
 * Manages app window focus state and dispatches OS-level notifications when
 * the app is in the background and a task needs user attention.
 *
 * Click handling: the plugin does NOT expose a native click event on desktop.
 * Instead we track window focus — when the user clicks a toast notification,
 * the OS activates the app window, and the focus-change handler navigates to
 * the associated task.
 */
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useUIStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { createLogger } from '@/lib/logger'

const log = createLogger('Notifications')

// ── Focus state ──────────────────────────────────────────────────────

let _appFocused = true
let _focusUnlisten: UnlistenFn | null = null

export function isAppFocused(): boolean {
  return _appFocused
}

export async function initFocusTracking(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const currentWindow = getCurrentWindow()

    _focusUnlisten = await currentWindow.onFocusChanged(({ payload: focused }) => {
      const wasFocused = _appFocused
      _appFocused = focused

      if (focused && !wasFocused) {
        // Defer so any in-flight state updates settle first
        setTimeout(() => drainPendingNavigation(), 50)
      }
    })

    try {
      _appFocused = await currentWindow.isFocused()
    } catch {
      _appFocused = document.hasFocus()
    }
    log.info('Focus tracking initialised', { focused: _appFocused })
  } catch (err) {
    log.warn('Tauri focus events unavailable, falling back to document focus', err)
    setupDocumentFocusFallback()
  }
}

function setupDocumentFocusFallback(): void {
  const onFocus = (): void => {
    const wasFocused = _appFocused
    _appFocused = true
    if (!wasFocused) setTimeout(() => drainPendingNavigation(), 50)
  }
  const onBlur = (): void => {
    _appFocused = false
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  _appFocused = document.hasFocus()

  _focusUnlisten = ((): void => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }) as unknown as UnlistenFn
}

export function destroyFocusTracking(): void {
  _focusUnlisten?.()
  _focusUnlisten = null
}

// ── Permission ───────────────────────────────────────────────────────

let _permissionChecked = false

export async function ensureNotificationPermission(): Promise<boolean> {
  if (_permissionChecked) return await isPermissionGranted()

  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const result = await requestPermission()
      granted = result === 'granted'
    }
    _permissionChecked = true
    log.info('Notification permission', { granted })
    return granted
  } catch (err) {
    _permissionChecked = true
    return false
  }
}

// ── Pending navigation ───────────────────────────────────────────────

let _pendingTaskId: string | null = null

function drainPendingNavigation(): void {
  const taskId = _pendingTaskId
  if (!taskId) return

  const chatStore = useChatStore.getState()
  if (!chatStore.tasks.find((t) => t.id === taskId)) {
    _pendingTaskId = null
    return
  }

  log.info('Navigating to notified task', { taskId })
  _pendingTaskId = null
  useUIStore.getState().navigateToTask(taskId)

  // Also try to ensure the window is visible
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    getCurrentWindow().unminimize().catch(() => {})
  }).catch(() => {})
}

// ── Send ─────────────────────────────────────────────────────────────

interface NotifyOptions {
  taskId: string
  title: string
  body: string
}

async function notify({ taskId, title, body }: NotifyOptions): Promise<void> {
  if (_appFocused) return

  const permissionGranted = await ensureNotificationPermission()
  if (!permissionGranted) return

  try {
    _pendingTaskId = taskId
    sendNotification({ title, body })
    log.info('Notification sent', { title, body, taskId })
  } catch (err) {
    log.error('Failed to send notification', err)
  }
}

export function notifyTaskComplete(taskId: string, title: string, body: string): void {
  notify({ taskId, title, body }).catch(() => {})
}

export function notifyApprovalNeeded(taskId: string, title: string, body: string): void {
  notify({ taskId, title, body }).catch(() => {})
}

export function notifyUserInputNeeded(taskId: string, title: string, body: string): void {
  notify({ taskId, title, body }).catch(() => {})
}

export function notifyTaskError(taskId: string, title: string, body: string): void {
  notify({ taskId, title, body }).catch(() => {})
}
