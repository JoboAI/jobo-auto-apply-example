import { describe, expect, it } from 'vitest'
import { open, seal } from '@/lib/secret-box'

const secret = 'a-long-random-encryption-secret-for-tests'
const key = 'jbe_live_abcdefghijklmnopqrstu_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'

describe('sealed API keys', () => {
  it('round-trips, with a fresh IV every time', () => {
    const a = seal(key, secret)
    const b = seal(key, secret)
    expect(a).not.toBe(b)
    expect(a).not.toContain('jbe_')
    expect(open(a, secret)).toBe(key)
    expect(open(b, secret)).toBe(key)
  })
  it('refuses the wrong secret', () => {
    expect(() => open(seal(key, secret), `${secret}-rotated`)).toThrow()
  })
  it('refuses any tampering', () => {
    const [version, iv, tag, body] = seal(key, secret).split('.')
    const flip = (part: string) => {
      const bytes = Buffer.from(part, 'base64url')
      bytes[0] ^= 1
      return bytes.toString('base64url')
    }
    expect(() => open([version, iv, tag, flip(body)].join('.'), secret)).toThrow()
    expect(() => open([version, iv, flip(tag), body].join('.'), secret)).toThrow()
    expect(() => open([version, flip(iv), tag, body].join('.'), secret)).toThrow()
    expect(() => open(['v2', iv, tag, body].join('.'), secret)).toThrow()
    expect(() => open('not-sealed', secret)).toThrow()
  })
})
