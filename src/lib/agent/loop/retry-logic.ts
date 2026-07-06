const BASE_RETRY_DELAY_MS = 1_500

export class ProviderRequestError extends Error {
  statusCode?: number
  errorType?: string

  constructor(message: string, options?: { statusCode?: number; type?: string }) {
    super(message)
    this.name = 'ProviderRequestError'
    this.statusCode = options?.statusCode
    this.errorType = options?.type
  }
}

export function extractErrorType(err: unknown): string | null {
  if (err instanceof ProviderRequestError && typeof err.errorType === 'string') {
    return err.errorType
  }

  if (
    err &&
    typeof err === 'object' &&
    'errorType' in err &&
    typeof (err as { errorType?: unknown }).errorType === 'string'
  ) {
    return (err as { errorType: string }).errorType
  }

  return null
}

export function isCircuitOpenError(err: unknown): boolean {
  const errorType = extractErrorType(err)
  if (errorType === 'transport_circuit_open') return true
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return message.includes('circuit is open')
}

export function isTransportFailure(err: unknown): boolean {
  const errorType = extractErrorType(err)
  if (errorType === 'transport_error' || errorType === 'transport_circuit_open') return true
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    message.includes('response ended prematurely') ||
    message.includes('responseended') ||
    message.includes('unexpected eof') ||
    message.includes('socket hang up') ||
    message.includes('connection closed') ||
    message.includes('connection timeout') ||
    message.includes('request timed out') ||
    message.includes('stream idle timeout') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  )
}

export function getRetryDelay(err: unknown, attempt: number, streamedContent: boolean): number | null {
  if (isCircuitOpenError(err)) return null

  const status = extractStatusCode(err)

  if (status === 429) {
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt + 1)
  }

  if (status && status >= 400 && status < 500) {
    // Non-retryable client errors
    return null
  }

  if (status && status >= 500) {
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
  }

  if (isTransportFailure(err) && !streamedContent) {
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
  }

  // If the provider didn't stream anything before failing, treat it as transient
  if (!streamedContent) {
    return BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
  }

  // Default small backoff for partial streams
  return BASE_RETRY_DELAY_MS
}

export function isAccountFailoverCandidate(err: unknown): boolean {
  const status = extractStatusCode(err)
  if (status && status >= 500) return true
  if (status === 401 || status === 403 || status === 429) return true
  if (isTransportFailure(err)) return true
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('quota') ||
    message.includes('auth_error') ||
    message.includes('unauthorized')
  ) {
    return true
  }
  return false
}

export function extractStatusCode(err: unknown): number | null {
  if (err instanceof ProviderRequestError && typeof err.statusCode === 'number') {
    return err.statusCode
  }

  if (
    err &&
    typeof err === 'object' &&
    'statusCode' in err &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  ) {
    return (err as { statusCode: number }).statusCode
  }

  const errorType = extractErrorType(err)
  if (errorType) {
    const typeMatch = /^http_(\d{3})$/i.exec(errorType)
    if (typeMatch) {
      const code = Number(typeMatch[1])
      return Number.isFinite(code) ? code : null
    }
  }

  const message = err instanceof Error ? err.message : String(err)
  const match = /HTTP\s+(\d{3})/i.exec(message)
  if (match) {
    const code = Number(match[1])
    return Number.isFinite(code) ? code : null
  }

  return null
}

export function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = (): void => {
      clearTimeout(timer)
      cleanup()
      reject(new Error('aborted'))
    }

    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
