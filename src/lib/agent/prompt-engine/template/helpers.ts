// Built-in template helpers. Helpers are invoked when a tag's first token
// matches a registered name, e.g. `{{#if eq role "worker"}}` or `{{join arr ", "}}`.

export type HelperFn = (...args: unknown[]) => unknown

const helpers = new Map<string, HelperFn>()

function register(name: string, fn: HelperFn): void {
  helpers.set(name, fn)
}

register('eq', (a, b) => looseEqual(a, b))
register('neq', (a, b) => !looseEqual(a, b))
register('or', (a, b) => (truthy(a) ? a : b))
register('and', (a, b) => (truthy(a) ? b : a))
register('not', (a) => !truthy(a))
register('len', (a) => (Array.isArray(a) ? a.length : a == null ? 0 : String(a).length))
register('join', (a, sep) => (Array.isArray(a) ? a.map((v) => String(v)).join(String(sep ?? ',')) : ''))
register('includes', (a, val) => Array.isArray(a) && a.includes(val))

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Allow number/string comparison (e.g. len result vs "0").
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b)
  }
  return String(a) === String(b)
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.length > 0
  return Boolean(v)
}

export function hasHelper(name: string): boolean {
  return helpers.has(name)
}

export function callHelper(name: string, args: unknown[]): unknown {
  const fn = helpers.get(name)
  if (!fn) throw new Error(`Unknown helper: ${name}`)
  return fn(...args)
}

/** Used by `#if`/`#unless` to coerce resolved values to booleans. */
export function isTruthy(v: unknown): boolean {
  return truthy(v)
}
