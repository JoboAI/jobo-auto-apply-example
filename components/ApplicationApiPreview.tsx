import { Braces } from 'lucide-react'
import type { ApiExchangeRow } from '@/db/schema'
import { displayDate } from '@/lib/presentation'
import { curlCommand, parsePreviewMessage, type PreviewMessage } from '@/lib/jobo/api-preview'
import { highlightJson } from '@/lib/json-highlight'
import { CodeBlock } from './CodeBlock'
import { CopyCurlButton } from './CopyCurlButton'

function headerText(lines: [string, string][]): string {
  return lines.map(([key, value]) => `${key}: ${value}`).join('\n')
}

function Message({
  kind,
  index,
  startLine,
  message,
  extraHeaders = [],
}: {
  kind: 'Request' | 'Response'
  index: number
  startLine: string
  message: PreviewMessage
  extraHeaders?: [string, string][]
}) {
  const headers = headerText([...extraHeaders, ...message.headers])
  const head = `${startLine}\n${headers}`.trim()
  return (
    <>
      <CodeBlock
        title="Headers"
        copy={head}
        label={`${kind} ${index} headers`}
      >
        <span className="tok-start">{startLine}</span>
        {headers && `\n${headers}`}
      </CodeBlock>
      {message.body !== null ? (
        <CodeBlock
          title="Body"
          note={message.truncated ? 'Truncated: very large body' : 'application/json'}
          copy={message.body}
          label={`${kind} ${index} JSON`}
        >
          {highlightJson(message.body)}
        </CodeBlock>
      ) : (
        <p className="code-empty">No body.</p>
      )}
    </>
  )
}

export function ApplicationApiPreview({ exchanges }: { exchanges: ApiExchangeRow[] }) {
  return (
    <details className="surface api-preview">
      <summary><span><Braces size={21} /> API requests & responses</span><span className="tag">{exchanges.length} exchanges</span></summary>
      <p>Actual HTTP exchanges with the Auto Apply API. Credentials, cookies, and signed download tokens are removed before recording. Your application answers remain visible only to you.</p>
      {!exchanges.length && <div className="answers-empty">No API exchanges were recorded for this application. Capture starts with new API calls; older responses cannot be reconstructed.</div>}
      {exchanges.length >= 100 && <p className="notice">Showing the first 100 exchanges. Further calls are not captured.</p>}
      {exchanges.map((exchange, index) => {
        const n = index + 1
        const url = new URL(exchange.url)
        const request = parsePreviewMessage(exchange.requestJson)
        const response = exchange.responseJson ? parsePreviewMessage(exchange.responseJson) : null
        return (
          <details className="api-exchange" key={exchange.id}>
            <summary>
              <span><b>{exchange.method}</b> {url.pathname}</span>
              <span className="tag">{exchange.statusCode ? `HTTP ${exchange.statusCode}` : exchange.finishedAt ? 'No response' : 'Awaiting response'}</span>
            </summary>
            <div className="api-exchange-meta">Exchange {n} · {displayDate(exchange.startedAt)}{exchange.elapsedMs !== null && ` · ${(exchange.elapsedMs / 1000).toFixed(2)}s`}</div>
            <div className="api-payloads">
              <section aria-label={`Request ${n}`}>
                <div className="api-message-head">
                  <h3>Request</h3>
                  <CopyCurlButton text={curlCommand(exchange.method, exchange.url, request)} index={n} />
                </div>
                <Message
                  kind="Request"
                  index={n}
                  startLine={`${exchange.method} ${url.pathname}${url.search} HTTP/1.1\nhost: ${url.host}`}
                  extraHeaders={[['x-api-key', '[REDACTED]']]}
                  message={request}
                />
              </section>
              <section aria-label={`Response ${n}`}>
                <div className="api-message-head">
                  <h3>Response{exchange.statusCode ? ` · HTTP ${exchange.statusCode}` : ''}</h3>
                </div>
                {exchange.error && <p className="notice warning">{exchange.error}</p>}
                {response ? (
                  <Message
                    kind="Response"
                    index={n}
                    startLine={`HTTP/1.1 ${exchange.statusCode ?? ''}`.trim()}
                    message={response}
                  />
                ) : (
                  <p className="code-empty">No response body was recorded{exchange.finishedAt ? '.' : ' yet. A request without a recorded response does not confirm submission.'}</p>
                )}
              </section>
            </div>
          </details>
        )
      })}
    </details>
  )
}
