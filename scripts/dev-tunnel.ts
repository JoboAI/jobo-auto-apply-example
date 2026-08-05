/**
 * Start the tunnel and the dev server as one command.
 *
 *   npm run dev:tunnel
 *
 * Why this exists: Jobo only calls a public HTTPS origin on port 443, and a
 * Cloudflare quick tunnel gets a fresh random `*.trycloudflare.com` hostname
 * every time it starts. Done by hand that is a four-step loop — start the
 * tunnel, copy the origin, edit `.env.local`, restart the dev server — and the
 * restart is not optional, because Next.js reads server env at boot and
 * `lib/config.ts` caches the parsed result.
 *
 * So: start the tunnel first, wait for the hostname it was given, and hand it
 * to `next dev` in its environment. Values already in the environment take
 * precedence over `.env.local` in Next's loader, so this wins without
 * disturbing anything else you have set there.
 *
 * The hostname is still different every run. That is fine and worth
 * understanding: this app sends `callback_url` on every create, so nothing
 * server-side is pinned to it. If you want an origin that survives restarts —
 * because you set the portal's `default_callback_url` rather than passing it
 * per application — see "A tunnel that survives restarts" in the README.
 */

import { spawn, type ChildProcess } from 'node:child_process'

const PORT = Number(process.env.PORT ?? 3000)

/** How long to wait for cloudflared to report its hostname before giving up. */
const HOSTNAME_TIMEOUT_MS = 60_000

const QUICK_TUNNEL_ORIGIN = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/

const children: ChildProcess[] = []
let shuttingDown = false

function shutdown(code: number): never {
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(0))
}

/**
 * Start cloudflared and resolve with the origin it prints.
 *
 * The hostname is scraped from cloudflared's own output — it announces the
 * quick tunnel in a banner on stderr. Its logs are forwarded so a failure to
 * connect is visible rather than swallowed.
 */
function startTunnel(): Promise<string> {
  return new Promise((resolve, reject) => {
    const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    children.push(tunnel)

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(
        new Error(
          `cloudflared did not report a hostname within ${HOSTNAME_TIMEOUT_MS / 1000}s. ` +
            'Its output above should say why.'
        )
      )
    }, HOSTNAME_TIMEOUT_MS)

    const scan = (chunk: Buffer) => {
      const text = chunk.toString()
      process.stderr.write(text)
      if (settled) return
      const match = text.match(QUICK_TUNNEL_ORIGIN)
      if (match) {
        settled = true
        clearTimeout(timer)
        resolve(match[0])
      }
    }

    tunnel.stdout.on('data', scan)
    tunnel.stderr.on('data', scan)

    tunnel.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        error.code === 'ENOENT'
          ? new Error(
              'cloudflared is not installed.\n\n' +
                '  brew install cloudflared\n\n' +
                'Or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
            )
          : error
      )
    })

    tunnel.on('exit', (code) => {
      if (shuttingDown) return
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error(`cloudflared exited with code ${code} before reporting a hostname.`))
        return
      }
      console.error('\ncloudflared exited — the callback URL is no longer reachable.')
      shutdown(code ?? 1)
    })
  })
}

async function main(): Promise<void> {
  console.log(`\nStarting a Cloudflare quick tunnel to http://localhost:${PORT} …\n`)

  const origin = await startTunnel()

  console.log(
    [
      '',
      '─'.repeat(72),
      `  Public origin  ${origin}`,
      `  Callback URL   ${origin}/api/jobo/webhook`,
      '',
      '  Passed to the dev server as PUBLIC_BASE_URL — no .env.local edit needed.',
      '  Use the callback URL above when you verify the endpoint from the portal.',
      '─'.repeat(72),
      ''
    ].join('\n')
  )

  // `-p` rather than letting Next pick a free port: the tunnel is already
  // pointed at PORT, and a dev server that quietly moved to 3001 would produce
  // a tunnel that 502s with nothing obviously wrong.
  const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_BASE_URL: origin }
  })
  children.push(dev)

  dev.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0)
  })
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  shutdown(1)
})
