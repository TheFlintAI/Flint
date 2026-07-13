
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 292
const LEFT_SIDEBAR_MIN_WIDTH = 272
const LEFT_SIDEBAR_MAX_WIDTH = 420
export const LEFT_SIDEBAR_COLLAPSED_WIDTH = 6

export const RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_MIN_WIDTH = 260
const RIGHT_PANEL_MAX_WIDTH = 480
export const RIGHT_PANEL_GUTTER_WIDTH = 6

export function clampLeftSidebarWidth(width: number): number {
  return Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, width))
}

export function clampRightPanelWidth(width: number): number {
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width))
}

const WORKSPACE_FILE_POPOVER_DEFAULT_WIDTH = 340
const WORKSPACE_FILE_POPOVER_MIN_WIDTH = 280
const WORKSPACE_FILE_POPOVER_MAX_WIDTH = 560

export function clampWorkspaceFilePopoverWidth(width: number): number {
  return Math.min(WORKSPACE_FILE_POPOVER_MAX_WIDTH, Math.max(WORKSPACE_FILE_POPOVER_MIN_WIDTH, width))
}

export { WORKSPACE_FILE_POPOVER_DEFAULT_WIDTH }
