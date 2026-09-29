import { Braces } from 'lucide-react'
import type { ApiExchangeRow } from '@/db/schema'
import { displayDate } from '@/lib/presentation'

export function ApplicationApiPreview({ exchanges }: { exchanges: ApiExchangeRow[] }) {
  return (
    <details className="surface api-preview">
      <summary><span><Braces size={21} /> API requests & responses</span><span className="tag">{exchanges.length} exchanges</span></summary>
      <p>Actual HTTP exchanges with the Auto Apply API. Credentials, cookies, and signed download tokens are removed before recording. Your application answers remain visible only to you.</p>
      {!exchanges.length && <div className="answers-empty">No API exchanges were recorded for this application. Capture starts with new API calls; older responses cannot be reconstructed.</div>}
      {exchanges.length >= 100 && <p className="notice">Showing the first 100 exchanges. Further calls are not captured.</p>}
      {exchanges.map((exchange, index) => (
        <details className="api-exchange" key={exchange.id}>
          <summary>
            <span><b>{exchange.method}</b> {new URL(exchange.url).pathname}</span>
            <span className="tag">{exchange.statusCode ? `HTTP ${exchange.statusCode}` : exchange.finishedAt ? 'No response' : 'Awaiting response'}</span>
          </summary>
          <div className="api-exchange-meta">Exchange {index + 1} · {displayDate(exchange.startedAt)}{exchange.elapsedMs !== null && ` · ${(exchange.elapsedMs / 1000).toFixed(2)}s`}</div>
          <div className="api-payloads">
            <section aria-label={`Request ${index + 1}`}>
              <h3>Request</h3><code className="api-url">{exchange.method} {exchange.url}</code>
              <pre tabIndex={0} aria-label={`Request ${index + 1} JSON`}><code>{exchange.requestJson}</code></pre>
            </section>
            <section aria-label={`Response ${index + 1}`}>
              <h3>Response{exchange.statusCode ? ` · HTTP ${exchange.statusCode}` : ''}</h3>
              {exchange.error && <p className="notice warning">{exchange.error}</p>}
              {exchange.responseJson ? <pre tabIndex={0} aria-label={`Response ${index + 1} JSON`}><code>{exchange.responseJson}</code></pre> : <p>No response body was recorded{exchange.finishedAt ? '.' : ' yet. A request without a recorded response does not confirm submission.'}</p>}
            </section>
          </div>
        </details>
      ))}
    </details>
  )
}
