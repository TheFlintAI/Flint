import type {
  OpenAIComputerActionType,
  ToolCallExtraContent,
  StreamEvent,
  UnifiedMessage,
  ContentBlock
} from '../types'

export const DESKTOP_CLICK_TOOL_NAME = 'DesktopClick' as const
export const DESKTOP_SCREENSHOT_TOOL_NAME = 'DesktopScreenshot' as const
export const DESKTOP_SCROLL_TOOL_NAME = 'DesktopScroll' as const
export const DESKTOP_TYPE_TOOL_NAME = 'DesktopType' as const
export const DESKTOP_WAIT_TOOL_NAME = 'DesktopWait' as const

export interface ComputerActionInputDescriptor {
  toolName: string
  input: Record<string, unknown>
  extraContent: ToolCallExtraContent
}

export function getComputerActionType(value: unknown): OpenAIComputerActionType | null {
  switch (value) {
    case 'click':
    case 'double_click':
    case 'scroll':
    case 'keypress':
    case 'type':
    case 'wait':
    case 'screenshot':
      return value
    default:
      return null
  }
}

export function normalizeComputerKey(key: string): string | null {
  const normalized = key.trim().toUpperCase()
  const map: Record<string, string> = {
    ENTER: 'Enter',
    TAB: 'Tab',
    ESCAPE: 'Escape',
    ESC: 'Escape',
    BACKSPACE: 'Backspace',
    DELETE: 'Delete',
    UP: 'ArrowUp',
    ARROWUP: 'ArrowUp',
    DOWN: 'ArrowDown',
    ARROWDOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    ARROWLEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    ARROWRIGHT: 'ArrowRight',
    HOME: 'Home',
    END: 'End',
    PAGEUP: 'PageUp',
    PAGEDOWN: 'PageDown',
    SPACE: 'Space',
    CTRL: 'Control',
    CONTROL: 'Control',
    CMD: 'Meta',
    COMMAND: 'Meta',
    META: 'Meta',
    ALT: 'Alt',
    OPTION: 'Alt',
    SHIFT: 'Shift'
  }

  if (map[normalized]) return map[normalized]
  if (/^[A-Z0-9]$/.test(normalized)) return normalized
  const functionKey = normalized.match(/^F([1-9]|1[0-2])$/)
  if (functionKey) return `F${functionKey[1]}`
  return null
}

export function buildComputerToolUseId(
  callId: string,
  actionIndex: number,
  toolName: string,
  suffix: number
): string {
  const safeToolName = toolName.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()
  return `${callId}__${actionIndex}__${safeToolName}__${suffix}`
}

export function isComputerUseToolResultBlock(
  block: Extract<ContentBlock, { type: 'tool_result' }>,
  messages: UnifiedMessage[],
  currentMessageId: string
): boolean {
  const currentIndex = messages.findIndex((message) => message.id === currentMessageId)
  if (currentIndex <= 0) return false
  const previousMessage = messages[currentIndex - 1]
  if (!previousMessage || !Array.isArray(previousMessage.content)) return false
  return previousMessage.content.some(
    (candidate) =>
      candidate.type === 'tool_use' &&
      candidate.id === block.toolUseId &&
      candidate.extraContent?.openaiResponses?.computerUse?.kind === 'computer_use'
  )
}

export function mapComputerActionDescriptor(
  callId: string,
  actionType: Exclude<OpenAIComputerActionType, 'screenshot'>,
  action: Record<string, unknown>,
  index: number
): ComputerActionInputDescriptor[] {
  const computerUse = {
    kind: 'computer_use' as const,
    computerCallId: callId,
    computerActionType: actionType,
    computerActionIndex: index
  }

  if (actionType === 'click' || actionType === 'double_click') {
    return [
      {
        toolName: DESKTOP_CLICK_TOOL_NAME,
        input: {
          x: Number(action.x ?? 0),
          y: Number(action.y ?? 0),
          button: typeof action.button === 'string' ? action.button : 'left',
          action: actionType === 'double_click' ? 'double_click' : 'click'
        },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  if (actionType === 'scroll') {
    return [
      {
        toolName: DESKTOP_SCROLL_TOOL_NAME,
        input: {
          ...(typeof action.x === 'number' ? { x: action.x } : {}),
          ...(typeof action.y === 'number' ? { y: action.y } : {}),
          scrollX: Number(action.scrollX ?? 0),
          scrollY: Number(action.scrollY ?? 0)
        },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  if (actionType === 'type') {
    return [
      {
        toolName: DESKTOP_TYPE_TOOL_NAME,
        input: {
          text: typeof action.text === 'string' ? action.text : ''
        },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  if (actionType === 'wait') {
    return [
      {
        toolName: DESKTOP_WAIT_TOOL_NAME,
        input: { delayMs: 2000 },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  const keys = Array.isArray(action.keys)
    ? action.keys.filter((item): item is string => typeof item === 'string')
    : []
  if (keys.length === 0) {
    return []
  }

  const normalizedKeys = keys
    .map((key) => normalizeComputerKey(key))
    .filter((key): key is string => Boolean(key))

  if (normalizedKeys.length === 0) {
    return []
  }

  if (normalizedKeys.length === 1) {
    return [
      {
        toolName: DESKTOP_TYPE_TOOL_NAME,
        input: { key: normalizedKeys[0] },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  const modifiers = normalizedKeys.slice(0, -1)
  const mainKey = normalizedKeys[normalizedKeys.length - 1]
  const modifierSet = new Set(['Control', 'Meta', 'Alt', 'Shift'])
  if (modifiers.every((key) => modifierSet.has(key))) {
    return [
      {
        toolName: DESKTOP_TYPE_TOOL_NAME,
        input: { hotkey: [...modifiers, mainKey] },
        extraContent: {
          openaiResponses: {
            computerUse
          }
        }
      }
    ]
  }

  return normalizedKeys.map((key, keyIndex) => ({
    toolName: DESKTOP_TYPE_TOOL_NAME,
    input: { key },
    extraContent: {
      openaiResponses: {
        computerUse: {
          ...computerUse,
          computerActionIndex: index * 100 + keyIndex
        }
      }
    }
  }))
}

export function mapComputerActionsToToolCalls(
  callId: string,
  actions: Array<Record<string, unknown>>
): ComputerActionInputDescriptor[] {
  const descriptors: ComputerActionInputDescriptor[] = []
  let sawScreenshot = false

  actions.forEach((action, index) => {
    const actionType = getComputerActionType(action.type)
    if (!actionType) return

    if (actionType === 'screenshot') {
      sawScreenshot = true
      descriptors.push({
        toolName: DESKTOP_SCREENSHOT_TOOL_NAME,
        input: {},
        extraContent: {
          openaiResponses: {
            computerUse: {
              kind: 'computer_use',
              computerCallId: callId,
              computerActionType: actionType,
              computerActionIndex: index
            }
          }
        }
      })
      return
    }

    descriptors.push(...mapComputerActionDescriptor(callId, actionType, action, index))
  })

  if (!sawScreenshot) {
    descriptors.push({
      toolName: DESKTOP_SCREENSHOT_TOOL_NAME,
      input: {},
      extraContent: {
        openaiResponses: {
          computerUse: {
            kind: 'computer_use',
            computerCallId: callId,
            computerActionType: 'screenshot',
            computerActionIndex: actions.length,
            autoAddedScreenshot: true
          }
        }
      }
    })
  }

  return descriptors
}

export function buildComputerUseToolEvents(
  item: {
    call_id?: string
    actions?: Array<Record<string, unknown>>
  },
  emittedComputerCallIds: Set<string>
): StreamEvent[] {
  const callId = typeof item.call_id === 'string' ? item.call_id : null
  if (!callId || emittedComputerCallIds.has(callId)) return []
  emittedComputerCallIds.add(callId)

  const actions = Array.isArray(item.actions) ? item.actions : []
  const descriptors = mapComputerActionsToToolCalls(callId, actions)
  const events: StreamEvent[] = []

  for (const descriptor of descriptors) {
    const toolUseId = buildComputerToolUseId(
      callId,
      descriptor.extraContent.openaiResponses?.computerUse?.computerActionIndex ?? 0,
      descriptor.toolName,
      events.length
    )
    events.push({
      type: 'tool_call_start',
      toolCallId: toolUseId,
      toolName: descriptor.toolName,
      toolCallExtraContent: descriptor.extraContent
    })
    events.push({
      type: 'tool_call_end',
      toolCallId: toolUseId,
      toolName: descriptor.toolName,
      toolCallInput: descriptor.input,
      toolCallExtraContent: descriptor.extraContent
    })
  }

  return events
}
