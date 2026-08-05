import { describe, expect, it } from 'vitest'
import { extractResumeText, looksLikePdf } from '@/lib/resume/extract'

/**
 * pdf.js TRANSFERS the buffer it is given, which detaches the caller's view of
 * it. That broke resume upload completely and silently: extraction succeeded,
 * then `saveResume(id, bytes)` threw "Cannot perform Construct on a detached
 * ArrayBuffer" — surfacing to the browser as an empty 500 and the useless
 * client-side message "Unexpected end of JSON input".
 *
 * The bug is invisible unless you look at the buffer AFTER extracting, which
 * is what this does.
 */

/**
 * A minimal single-page PDF carrying a real text stream.
 *
 * The body is padded past MIN_MEANINGFUL_CHARS (200 non-whitespace) because
 * extractResumeText rejects anything shorter as a scan — a two-line fixture
 * fails the guard before it can prove anything about the buffer.
 */
function pdfWithText(lines: string[]): Uint8Array {
  const padded = [
    ...lines,
    'EXPERIENCE',
    'Northwind Robotics - Senior Backend Engineer - Remote - Mar 2022 to Present',
    'Designed the fleet-coordination control plane serving twelve thousand units.',
    'Babbage Systems - Backend Engineer - London - Jan 2019 to Feb 2022',
    'Built billing and reconciliation handling four million events per day.',
    'EDUCATION',
    'University of London - BSc Mathematics - Sep 2015 to Jun 2018',
    'SKILLS',
    'TypeScript, Go, PostgreSQL, Kubernetes, Terraform'
  ]
  const content =
    'BT /F1 11 Tf 40 760 Td 14 TL\n' +
    padded.map((line) => `(${line.replace(/[()\\]/g, '\\$&')}) Tj T*\n`).join('') +
    'ET'
  const stream = Buffer.from(content, 'latin1')
  const objects = [
    Buffer.from('<</Type/Catalog/Pages 2 0 R>>'),
    Buffer.from('<</Type/Pages/Kids[3 0 R]/Count 1>>'),
    Buffer.from(
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>'
    ),
    Buffer.concat([Buffer.from(`<</Length ${stream.length}>>stream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')
  ]

  let out = Buffer.from('%PDF-1.4\n')
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(out.length)
    out = Buffer.concat([out, Buffer.from(`${index + 1} 0 obj`), object, Buffer.from('endobj\n')])
  })
  const xref = out.length
  out = Buffer.concat([out, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)])
  for (const offset of offsets) {
    out = Buffer.concat([out, Buffer.from(`${String(offset).padStart(10, '0')} 00000 n \n`)])
  }
  out = Buffer.concat([
    out,
    Buffer.from(`trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`)
  ])
  return new Uint8Array(out)
}

describe('extractResumeText', () => {
  it('leaves the caller\'s buffer usable — pdf.js detaches what it is handed', async () => {
    const bytes = pdfWithText(['Ada Lovelace', 'Senior Backend Engineer'])
    const before = bytes.byteLength

    await extractResumeText(bytes)

    // The whole point: the route stores these bytes AFTER extracting.
    // `ArrayBuffer.detached` is ES2024 and not in this project's lib, but it
    // is the most direct assertion available, so reach for it explicitly
    // rather than widening the tsconfig for one test.
    const buffer = bytes.buffer as ArrayBuffer & { detached?: boolean }
    expect(buffer.detached ?? false).toBe(false)
    expect(bytes.byteLength).toBe(before)
    // And they must still be readable, which is what saveResume does.
    expect(() => new Uint8Array(bytes)).not.toThrow()
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('returns the text that was in the PDF', async () => {
    const text = await extractResumeText(pdfWithText(['Ada Lovelace', 'ada@example.com']))
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('ada@example.com')
  })

  it('rejects a non-PDF before touching pdf.js', async () => {
    await expect(extractResumeText(new Uint8Array(Buffer.from('just text')))).rejects.toThrow(/not a PDF/i)
  })

  it('looksLikePdf checks the magic bytes', () => {
    expect(looksLikePdf(new Uint8Array(Buffer.from('%PDF-1.4')))).toBe(true)
    expect(looksLikePdf(new Uint8Array(Buffer.from('PK')))).toBe(false)
  })
})
