
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 292
const LEFT_SIDEBAR_MIN_WIDTH = 272
const LEFT_SIDEBAR_MAX_WIDTH = 420
export const LEFT_SIDEBAR_COLLAPSED_WIDTH = 6

export const RIGHT_PANEL_DEFAULT_WIDTH = 360
const RIGHT_PANEL_MIN_WIDTH = 260
const RIGHT_PANEL_MAX_WIDTH = 480
export const RIGHT_PANEL_GUTTER_WIDTH = 6
export const WORKING_FOLDER_PANEL_DEFAULT_WIDTH = 420
const WORKING_FOLDER_PANEL_MIN_WIDTH = 280
const WORKING_FOLDER_PANEL_MAX_WIDTH = 560

export function clampLeftSidebarWidth(width: number): number {
  return Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, width))
}

export function clampRightPanelWidth(width: number): number {
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width))
}

export function clampWorkingFolderPanelWidth(width: number): number {
  return Math.min(WORKING_FOLDER_PANEL_MAX_WIDTH, Math.max(WORKING_FOLDER_PANEL_MIN_WIDTH, width))
}
