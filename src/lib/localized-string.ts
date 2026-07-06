/**
 * Shared localized string type and resolution.
 *
 * Used across the entire app — plugin system, provider presets, etc.
 *
 * `LocalizedString` is either a plain string (backward compatible)
 * or a `Record<string, string>` mapping language codes to translations.
 *
 * Resolution order: target language → 'en' → first available → ''.
 */

export type LocalizedString = string | Record<string, string>

/** Resolve a LocalizedString to the target language. */
export function resolveLocalizedString(value: LocalizedString, language: string): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return ''
  const keys = Object.keys(value)
  if (keys.length === 0) return ''
  return value[language] ?? value['en'] ?? value[keys[0]] ?? ''
}

import i18n from '@/locales'

/**
 * Convenience wrapper — resolves a localized name using the current i18n language.
 * For explicit language control, use `resolveLocalizedString(name, language)` directly.
 */
export function displayName(name: LocalizedString | null | undefined): string {
  if (!name) return ''
  return resolveLocalizedString(name, i18n.language)
}
