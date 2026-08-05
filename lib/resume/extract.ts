import { extractText, getDocumentProxy } from 'unpdf'

/**
 * PDF text extraction.
 *
 * `unpdf` rather than the more obvious choices, for concrete reasons:
 *
 *   - `pdf-parse` reads a test fixture from its own package directory at import
 *     time when `module.parent` is undefined — which is exactly what happens
 *     once a bundler wraps it. You get an ENOENT for a file you never
 *     referenced, and it is a genuinely unpleasant afternoon to diagnose.
 *   - `pdfjs-dist` directly means configuring a worker, and on some code paths
 *     pulling in `canvas`, a native module with a Cairo build dependency.
 *
 * `unpdf` ships a serverless-targeted build of pdf.js with no native
 * dependencies and drops into a route handler with no bundler configuration.
 */

export class ResumeExtractionError extends Error {
  readonly code: 'not_a_pdf' | 'no_text' | 'extraction_failed'

  constructor(code: ResumeExtractionError['code'], message: string) {
    super(message)
    this.name = 'ResumeExtractionError'
    this.code = code
  }
}

/**
 * Below this many non-whitespace characters we assume the PDF is a scan or an
 * image export. Structuring an empty string produces a confidently fabricated
 * profile, which is a far worse outcome than an explicit error.
 */
const MIN_MEANINGFUL_CHARS = 200

export function looksLikePdf(bytes: Uint8Array): boolean {
  // %PDF-
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

export async function extractResumeText(bytes: Uint8Array): Promise<string> {
  if (!looksLikePdf(bytes)) {
    throw new ResumeExtractionError('not_a_pdf', 'That file is not a PDF (it does not start with %PDF-).')
  }

  let text: string
  try {
    // pdf.js TRANSFERS the buffer it is handed, leaving the caller's view
    // detached — `bytes.byteLength` becomes 0 and every later read of it
    // throws "Cannot perform Construct on a detached ArrayBuffer". The caller
    // still needs these bytes to store the file afterwards, so hand over a
    // copy and let pdf.js consume that instead.
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const extracted = await extractText(pdf, { mergePages: true })
    text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
  } catch (error) {
    throw new ResumeExtractionError(
      'extraction_failed',
      `Could not read that PDF: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const cleaned = text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (cleaned.replace(/\s/g, '').length < MIN_MEANINGFUL_CHARS) {
    throw new ResumeExtractionError(
      'no_text',
      'We extracted almost no text from this PDF — it is probably a scan or an image export. Upload a text-based PDF (export from Word, Google Docs or LaTeX rather than scanning), or create the profile by hand.'
    )
  }

  return cleaned
}
