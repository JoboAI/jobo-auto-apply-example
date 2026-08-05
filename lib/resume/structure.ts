import { config } from '@/lib/config'
import { complete } from '@/lib/openrouter'
import { normalizeProfile, resumeProfileSchema, type ResumeProfile } from './profile-schema'

/**
 * Turn extracted resume text into a structured profile.
 *
 * Unlike the answer path, this runs once per resume with no clock pressure, so
 * it uses a stronger model and a generous token budget. Everything downstream
 * reads this profile, so a mistake here is expensive and persistent — the UI
 * therefore drops the user straight into an editor afterwards rather than
 * treating the output as final.
 */

const SYSTEM_PROMPT = `You extract structured data from resumes. You are a parser, not a writer.

Rules:
- Use ONLY what the resume states. Never invent employers, titles, dates, degrees, or skills.
- Dates: always "YYYY-MM". If only a year is given use "YYYY-01". If a role is current, set is_current true and end_date null.
- Split the name into first_name and last_name as best you can.
- country_code is ISO 3166-1 alpha-2 (US, GB, NL, DE, ...). Infer it from an address or phone country code when it is unambiguous, otherwise null.
- Classify links by destination: linkedin.com -> "linkedin", github.com -> "github", a personal site -> "portfolio", anything else -> "other".
- Use null for anything genuinely absent. Do not write "N/A", "Unknown", or an empty string.
- Order work_experience and education most recent first.

The "about" block is different — there you may summarise and synthesise, because it is what open-ended application questions get answered from:
- summary: 2-3 sentences in the first person.
- motivation: what kind of role and company they appear to be looking for, grounded in their trajectory.
- strengths: 3-6 short phrases evidenced by the resume.
- notable_projects: concrete things they built or delivered.
- freeform_notes: leave "" — this is reserved for the candidate's own additions.`

export async function structureResume(text: string): Promise<ResumeProfile> {
  const c = config()

  const result = await complete({
    model: c.OPENROUTER_RESUME_MODEL,
    system: SYSTEM_PROMPT,
    user: `Extract a structured profile from this resume.\n\n<resume>\n${text.slice(0, 40_000)}\n</resume>`,
    schema: resumeProfileSchema,
    schemaName: 'resume_profile',
    // Parsing, not composing. Keep it as literal as the model allows.
    temperature: 0.1,
    // No reasoning pass: this is transcription into a schema, not a problem to
    // think through. It was adding billed tokens and seconds to an import for
    // no gain in the extracted profile.
    reasoning: false,
    maxTokens: 8192,
    timeoutMs: 120_000
  })

  // Normalise dates and the is_current/end_date invariant once, here, so that
  // no later stage has to think about it. This removes an entire class of
  // `invalid_date`, `date_precision` and `current_end_date` correction rounds.
  return normalizeProfile(result.data)
}

/** A readable profile name, e.g. "Ada Lovelace — Senior Backend Engineer". */
export function suggestProfileName(profile: ResumeProfile): string {
  const name = profile.personal.full_name?.trim() || 'Untitled profile'
  const headline = profile.personal.headline?.trim()
  return headline ? `${name} — ${headline}` : name
}
