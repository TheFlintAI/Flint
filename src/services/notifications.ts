/**
 * Cross-platform OS notification service.
 *
 * Sends notifications through the Rust backend:
 * - **Windows**: native WinRT toast via tauri-winrt-notification with
 *   on_activated callback → restores window + emits
 *   command:notification:clicked for task navigation.  A Start Menu
 *   shortcut (created during setup) provides the AUMI for Flint branding.
 * - **macOS / Linux**: notify-rust.
 *
 * Focus tracking suppresses notifications when the app is in the foreground.
 */
import {
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { useUIStore } from '@/stores/ui-store'
import { useChatStore } from '@/stores/chat-store'
import { tauriCommands } from '@/services/tauri-api/command-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('Notifications')

// ── Focus state ──────────────────────────────────────────────────────

let _appFocused = true
let _focusUnlisten: (() => void) | null = null

export function isAppFocused(): boolean {
  return _appFocused
}

export async function initFocusTracking(): Promise<void> {
  try {
    const currentWindow = getCurrentWindow()

    _focusUnlisten = await currentWindow.onFocusChanged(({ payload: focused }) => {
      _appFocused = focused
    })

    try {
      _appFocused = await currentWindow.isFocused()
    } catch {
      _appFocused = document.hasFocus()
    }

    // Listen for notification click events from the Rust backend.
    // The Rust side restores the window then emits this event so the
    // frontend can navigate to the relevant task.
    const unlisten = await listen<{ taskId: string }>('command:notification:clicked', (event) => {
      const { taskId } = event.payload
      log.info('Notification clicked, navigating to task', { taskId })
      const chatStore = useChatStore.getState()
      if (chatStore.tasks.find((t) => t.id === taskId)) {
        useUIStore.getState().navigateToTask(taskId)
      }
    })

    // Chain the unlisten into the focus unlisten for cleanup
    const origFocusUnlisten = _focusUnlisten
    _focusUnlisten = () => {
      origFocusUnlisten?.()
      unlisten()
    }

    log.info('Focus tracking initialised', { focused: _appFocused })
  } catch (err) {
    log.warn('Tauri focus events unavailable, falling back to document focus', err)
    setupDocumentFocusFallback()
  }
}

function setupDocumentFocusFallback(): void {
  const onFocus = (): void => { _appFocused = true }
  const onBlur = (): void => { _appFocused = false }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  _appFocused = document.hasFocus()

  _focusUnlisten = (): void => {
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }
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
    await tauriCommands.invoke('notification:send', { title, body, taskId })
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
