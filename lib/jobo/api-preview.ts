/** Sanitize before persistence, so credentials never reach storage or the UI. */
const sensitiveKey = /authorization|cookie|api[-_]?key|password|secret|token|signature|credential|^sig$|^x-amz-/i
const REDACTED = '[REDACTED]'
export const MAX_PREVIEW_CHARS = 256 * 1024

export function redactPreview(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 30) return '[Omitted: maximum nesting depth]'
  if (typeof value === 'string') {
    let text = value
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join(REDACTED)
      text = text.split(encodeURIComponent(secret)).join(REDACTED)
    }
    text = text.replace(/\b(?:jbe_(?:live|test)_|sk-or-v1-)[A-Za-z0-9_-]+/g, REDACTED)
    text = text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    return text.replace(/https?:\/\/[^\s"<>]+/g, raw => {
      try {
        const url = new URL(raw)
        if (url.username) url.username = REDACTED
        if (url.password) url.password = REDACTED
        for (const key of [...url.searchParams.keys()]) {
          if (sensitiveKey.test(key)) url.searchParams.set(key, REDACTED)
        }
        return url.toString()
      } catch { return '[Invalid URL omitted]' }
    })
  }
  if (Array.isArray(value)) return value.map(item => redactPreview(item, secrets, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      // Key names can contain echoed credentials too.
      String(redactPreview(key, secrets, depth + 1)),
      sensitiveKey.test(key) ? REDACTED : redactPreview(item, secrets, depth + 1),
    ]))
  }
  return value
}

export function previewJson(value: unknown, secrets: string[] = []): string {
  const safe = redactPreview(value, secrets)
  const text = JSON.stringify(safe, null, 2) ?? 'null'
  if (text.length <= MAX_PREVIEW_CHARS) return text
  // An HTTP message keeps its headers whole; only the body is cut, and the
  // preview says so instead of turning everything into one escaped string.
  if (isMessage(safe)) {
    const body = JSON.stringify(safe.body, null, 2) ?? 'null'
    return JSON.stringify({
      headers: safe.headers,
      truncated: true,
      body_length: body.length,
      body_excerpt: body.slice(0, MAX_PREVIEW_CHARS),
    }, null, 2)
  }
  return JSON.stringify({
    notice: 'Preview truncated at 256K characters.',
    excerpt: text.slice(0, MAX_PREVIEW_CHARS),
  }, null, 2)
}

function isMessage(value: unknown): value is { headers: Record<string, unknown>; body: unknown } {
  return !!value && typeof value === 'object' && 'headers' in value && 'body' in value
}

export interface PreviewMessage {
  headers: [string, string][]
  /** Pretty-printed body, or null when there was none. */
  body: string | null
  /** The body is an excerpt of a larger one. */
  truncated: boolean
}

/**
 * Read a stored preview back into headers and body for display. Tolerates
 * every shape ever stored, including the older whole-message excerpt.
 */
export function parsePreviewMessage(stored: string): PreviewMessage {
  let value: unknown
  try { value = JSON.parse(stored) } catch { return { headers: [], body: stored, truncated: false } }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { headers: [], body: JSON.stringify(value, null, 2), truncated: false }
  const record = value as Record<string, unknown>
  const headers = record.headers && typeof record.headers === 'object'
    ? Object.entries(record.headers as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)] as [string, string])
    : []
  if (typeof record.body_excerpt === 'string')
    return { headers, body: record.body_excerpt, truncated: true }
  if ('body' in record)
    return { headers, body: record.body === null ? null : JSON.stringify(record.body, null, 2), truncated: false }
  if (typeof record.excerpt === 'string')
    return { headers, body: record.excerpt, truncated: true }
  return { headers, body: JSON.stringify(value, null, 2), truncated: false }
}

/** A runnable cURL for a recorded request, with the key left as a variable. */
export function curlCommand(method: string, url: string, message: PreviewMessage): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const lines = [`curl -X ${method} ${quote(url)}`, `  -H "X-Api-Key: $JOBO_API_KEY"`]
  for (const [key, value] of message.headers) lines.push(`  -H ${quote(`${key}: ${value}`)}`)
  if (message.body !== null && !message.truncated) lines.push(`  --data ${quote(message.body)}`)
  return lines.join(' \\\n')
}

export function jsonBody(raw: string): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    // HTML error pages may contain edge cookies or secrets in executable code.
    return { notice: 'Non-JSON body omitted from preview.' }
  }
}
