import type { AnswerTrace } from '@/lib/answers/types'
import { Badge } from './ui'

/**
 * Per-field answer provenance — the "how was this answered" table for the
 * notebook's third cell. One row per field from the event's stored trace:
 * which deterministic rule fired, what the model produced, what a local
 * repair changed, and what was deliberately declined.
 */

const SOURCE_META: Record<
  AnswerTrace['source'],
  { label: string; tone: 'neutral' | 'good' | 'warn' | 'info' }
> = {
  deterministic: { label: 'rule', tone: 'neutral' },
  llm: { label: 'AI', tone: 'info' },
  repaired: { label: 'repaired', tone: 'warn' },
  previous_round: { label: 'previous round', tone: 'neutral' },
  dropped: { label: 'dropped', tone: 'warn' },
  declined: { label: 'declined', tone: 'neutral' }
}

function formatValue(entry: AnswerTrace): string | null {
  if (entry.value === undefined) return null
  const text = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

export function TraceTable({ trace }: { trace: AnswerTrace[] }) {
  if (trace.length === 0) return null

  return (
    <div className="overflow-x-auto border hairline bg-white">
      <table className="s-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Source</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {trace.map((entry, index) => {
            const meta = SOURCE_META[entry.source] ?? { label: entry.source, tone: 'neutral' }
            const value = formatValue(entry)
            return (
              <tr key={`${entry.field_id}-${index}`}>
                <td className="max-w-56">
                  <span className="block truncate font-medium text-ink-800">{entry.label}</span>
                  <span className="font-mono text-[11px] text-ink-500">{entry.type}</span>
                </td>
                <td className="whitespace-nowrap">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {entry.rule && (
                    <code className="ml-2 font-mono text-[11px] text-ink-500">{entry.rule}</code>
                  )}
                </td>
                <td className="max-w-80">
                  {value !== null ? (
                    <span className="block truncate text-ink-800">{value}</span>
                  ) : (
                    <span className="text-xs text-ink-500 italic">
                      {entry.reason ?? 'not answered'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
