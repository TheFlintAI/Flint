import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { RightPanelHeader } from './RightPanelHeader'
import { AdaptiveDashboard } from './AdaptiveDashboard'
import {
  RIGHT_PANEL_GUTTER_WIDTH,
  clampRightPanelWidth,
} from './panel-constants'

export function RightPanel(): React.JSX.Element {
  const rightPanelOpen = useUIStore((state) => state.rightPanelOpen)
  const rightPanelWidth = useUIStore((state) => state.rightPanelWidth)
  const setRightPanelWidth = useUIStore((state) => state.setRightPanelWidth)

  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(rightPanelWidth)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = startXRef.current - event.clientX
      setRightPanelWidth(
        clampRightPanelWidth(startWidthRef.current + delta),
      )
    }

    const handleMouseUp = (): void => {
      draggingRef.current = false
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setRightPanelWidth])

  const startResize = (event: React.MouseEvent): void => {
    if (!rightPanelOpen) return
    event.preventDefault()
    draggingRef.current = true
    startXRef.current = event.clientX
    startWidthRef.current = rightPanelWidth
    setIsDragging(true)
  }

  const panelWidth = clampRightPanelWidth(rightPanelWidth)
  const totalWidth = rightPanelOpen
    ? panelWidth + RIGHT_PANEL_GUTTER_WIDTH
    : 0

  return (
    <div
      className="relative z-40 h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
      style={{ width: totalWidth }}
    >
      {/* Inner layout always rendered at full panel width so content never
          reflows during the open/close animation. The outer overflow-hidden
          acts purely as an animation mask, revealing the fixed-width content
          as the panel slides in. */}
      <div className="flex h-full" style={{ width: panelWidth + RIGHT_PANEL_GUTTER_WIDTH }}>
        {/* Gutter — whitespace separator matching sidebar background */}
        <div
          className="relative h-full shrink-0 bg-sidebar group"
          style={{ width: RIGHT_PANEL_GUTTER_WIDTH }}
        >
          {/* Resize handle — visible on hover */}
          <div
            className={cn(
              'absolute inset-y-2 left-1/2 -translate-x-1/2 w-1 rounded-full',
              'cursor-col-resize opacity-0 transition-opacity',
              'group-hover:opacity-100 bg-muted-foreground/25',
              isDragging && 'opacity-100 bg-muted-foreground/50',
            )}
            onMouseDown={startResize}
          />
        </div>

        <aside
          className={cn(
            'relative flex h-full flex-col bg-background shadow-[-18px_0_42px_rgba(0,0,0,0.16)] transition-[opacity,transform] duration-300 ease-out',
            rightPanelOpen
              ? 'translate-x-0 opacity-100'
              : 'pointer-events-none translate-x-full opacity-0',
          )}
          style={{ width: panelWidth }}
        >
          <RightPanelHeader />

          <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
            <AdaptiveDashboard />
          </div>
        </aside>
      </div>

      {isDragging && (
        <div className="fixed inset-0 z-[100] cursor-col-resize" />
      )}
    </div>
  )
}
