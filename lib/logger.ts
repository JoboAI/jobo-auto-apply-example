/**
 * A deliberately tiny structured logger. Swap for pino/winston in a real app —
 * this exists so the webhook path emits greppable JSON without adding a
 * dependency a reader has to learn.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info

function emit(level: Level, fields: Record<string, unknown>, message: string) {
  if (ORDER[level] < MIN) return
  const payload = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...fields
  }
  const line = JSON.stringify(payload, (_key, value) =>
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
  )
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  debug: (fields: Record<string, unknown>, message: string) => emit('debug', fields, message),
  info: (fields: Record<string, unknown>, message: string) => emit('info', fields, message),
  warn: (fields: Record<string, unknown>, message: string) => emit('warn', fields, message),
  error: (fields: Record<string, unknown>, message: string) => emit('error', fields, message)
}
