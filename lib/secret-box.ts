import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Authenticated encryption for the API keys visitors connect in production
 * mode. AES-256-GCM, with the key HKDF-derived from API_KEY_ENCRYPTION_SECRET
 * so the env value can be any long random string.
 *
 * Pure on purpose (the secret is a parameter): config() caches, so a helper
 * that read it itself could not be tested against a wrong secret.
 *
 * Sealed format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
const VERSION = 'v1'
const INFO = 'jobo-demo/api-key/v1'

function derive(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32))
}

export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derive(secret), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

/** Throws on a wrong secret or any tampering — never returns garbage. */
export function open(sealed: string, secret: string): string {
  const [version, iv, tag, body, ...rest] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !body || rest.length)
    throw new Error('Unrecognised sealed value.')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(secret),
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
