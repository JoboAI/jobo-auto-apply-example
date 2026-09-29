/** Sanitize before persistence, so credentials never reach storage or the UI. */
const sensitiveKey = /authorization|cookie|api[-_]?key|password|secret|token|signature|credential|^sig$|^x-amz-/i
const REDACTED = '[REDACTED]'
export const MAX_PREVIEW_CHARS = 64 * 1024

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
  const text = JSON.stringify(redactPreview(value, secrets), null, 2) ?? 'null'
  return text.length <= MAX_PREVIEW_CHARS ? text : JSON.stringify({
    notice: 'Preview truncated at 64K characters.',
    excerpt: text.slice(0, MAX_PREVIEW_CHARS),
  }, null, 2)
}

export function jsonBody(raw: string): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch {
    // HTML error pages may contain edge cookies or secrets in executable code.
    return { notice: 'Non-JSON body omitted from preview.' }
  }
}
