import type { ReactNode } from 'react'

/**
 * Minimal JSON syntax colouring as React nodes (never HTML strings, so a
 * recorded payload cannot inject markup). Anything that is not a token is
 * passed through untouched, so non-JSON text still renders verbatim.
 */
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

export function highlightJson(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    const [whole, string, colon, literal, number] = match
    const key = nodes.length
    if (string !== undefined && colon !== undefined)
      nodes.push(<span key={key} className="tok-key">{string}</span>, colon)
    else if (string !== undefined)
      nodes.push(<span key={key} className="tok-string">{string}</span>)
    else if (literal !== undefined)
      nodes.push(<span key={key} className="tok-literal">{literal}</span>)
    else if (number !== undefined)
      nodes.push(<span key={key} className="tok-number">{number}</span>)
    else nodes.push(whole)
    last = index + whole.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
