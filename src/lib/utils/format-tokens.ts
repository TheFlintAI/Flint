import { encode } from 'gpt-tokenizer'

/**
 * Format a token count into a compact, human-readable string.
 * Examples: 0 → "0", 850 → "850", 1200 → "1.2k", 12500 → "12.5k", 1234567 → "1.23M"
 */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) {
    const k = n / 1_000
    return k < 10 ? `${k.toFixed(1)}k` : `${k.toFixed(0)}k`
  }
  const m = n / 1_000_000
  return m < 10 ? `${m.toFixed(2)}M` : `${m.toFixed(1)}M`
}

/**
 * Format token count with K/M units and always 2 decimal places (for animations)
 * Examples: 850 → "850", 1234 → "1.23K", 12500 → "12.50K", 1234567 → "1.23M"
 */
export function formatTokensDecimal(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) {
    const k = n / 1000
    return `${k.toFixed(2)}K`
  }
  const m = n / 1_000_000
  return `${m.toFixed(2)}M`
}

/**
 * Compute the total tokens (input + output).
 */
export function getTotalTokens(inputTokens: number, outputTokens?: number): number {
  return inputTokens + (outputTokens ?? 0)
}

/**
 * Estimate the number of tokens in a string using OpenAI's tokenizer (cl100k_base).
 * Use this only when the LLM does not provide token usage — prefer API-reported counts.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return encode(text, { allowedSpecial: 'all' }).length
}
