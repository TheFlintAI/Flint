/**
 * Manifest validation for plugin.toml.
 */

import permData from '../permissions.json' with { type: 'json' }

const VALID_PERMISSIONS = permData.permissions

export function validateManifest(manifest) {
  const errors = []

  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('"name" is required and must be a string')
  }
  if (!manifest.displayName || typeof manifest.displayName !== 'object') {
    errors.push('"displayName" is required and must be a localized object, e.g. { en = "...", zh = "..." }')
  }
  if (manifest.displayDescription !== undefined && typeof manifest.displayDescription !== 'object') {
    errors.push('"displayDescription" must be a localized object when provided')
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('"version" is required and must be a string')
  }
  if (typeof manifest.version === 'string') {
    const semver = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/
    if (!semver.test(manifest.version)) {
      errors.push(`"version" must be semver (e.g. "1.0.0"), got "${manifest.version}"`)
    }
  }
  if (!manifest.main || typeof manifest.main !== 'string') {
    errors.push('"main" is required and must point to the entry TypeScript file')
  }

  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      errors.push('"permissions" must be an array of strings when provided')
    } else {
      for (const perm of manifest.permissions) {
        if (typeof perm !== 'string') {
          errors.push('"permissions" entries must be strings')
          break
        }
        if (!VALID_PERMISSIONS.includes(perm)) {
          errors.push(`"permissions" contains unknown permission "${perm}". Valid: ${VALID_PERMISSIONS.join(', ')}`)
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid plugin.toml:\n  - ${errors.join('\n  - ')}`)
  }
}
