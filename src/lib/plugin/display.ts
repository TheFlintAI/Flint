/**
 * Plugin display helpers — resolve manifest displayName/displayDescription
 * using the shared `resolveLocalizedString` from @/lib/localized-string.
 */

import { resolveLocalizedString } from '@/lib/localized-string'

/** Resolve plugin display name. Falls back to manifest.name. */
export function resolveDisplayName(
  displayName: string | Record<string, string> | undefined,
  fallbackName: string,
  language: string,
): string {
  if (!displayName) return fallbackName
  const resolved = resolveLocalizedString(displayName, language)
  return resolved || fallbackName
}

/** Resolve plugin display description. */
export function resolveDisplayDescription(
  displayDescription: string | Record<string, string> | undefined,
  language: string,
): string | undefined {
  if (!displayDescription) return undefined
  const resolved = resolveLocalizedString(displayDescription, language)
  return resolved || undefined
}
