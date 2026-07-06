/**
 * Plugin permission definitions.
 *
 * Canonical permission data lives in @flint/plugin-sdk/permissions.json.
 * This module re-exports with TypeScript types for frontend consumption.
 */

import permData from '@flint/plugin-sdk/permissions.json'

export type PluginPermission = typeof permData.permissions[number]

/** Capability method → permissions that grant access. */
export const CAPABILITY_PERMISSIONS: Record<string, PluginPermission[]> = permData.capabilityMap

/** Maps permission values to i18n keys under `plugin.*`. */
export const PERMISSION_I18N_KEYS: Record<string, string> = permData.i18nKeys

/** All declarable permission values in display order. */
export const ALL_PERMISSIONS: PluginPermission[] = [...permData.permissions]

/** Check whether any of `required` permissions are present in `granted`. */
export function hasAnyPermission(granted: string[], required: string[]): boolean {
  return required.some(p => granted.includes(p))
}
