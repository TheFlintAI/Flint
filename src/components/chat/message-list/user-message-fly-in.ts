// Transient cache of the composer's viewport rect at send time, consumed by the
// freshly-mounted last user message to animate a fly-in from the input box.

export interface FlyInOriginRect {
  top: number
  left: number
  width: number
  height: number
}

const originsByTask = new Map<string, FlyInOriginRect>()

export function setUserMessageFlyInOrigin(taskId: string | null | undefined, rect: FlyInOriginRect): void {
  if (!taskId) return
  originsByTask.set(taskId, rect)
}

export function consumeUserMessageFlyInOrigin(taskId: string | null | undefined): FlyInOriginRect | null {
  if (!taskId) return null
  const rect = originsByTask.get(taskId)
  if (!rect) return null
  originsByTask.delete(taskId)
  return rect
}
