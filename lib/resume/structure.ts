import { config } from '@/lib/config'
import { complete } from '@/lib/openrouter'
import {
  currentRole,
  emptyEeo,
  emptyPreferences,
  emptyWorkAuthorization,
  fullName,
  normalizeProfile,
  resumeExtractSchema,
  type ResumeProfile
} from './profile-schema'

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
- Use ONLY what the resume states. Never invent employers, titles, dates, degrees, schools, or skills.
- Dates are separate month (1-12) and year integers. If only a year is given, set the month to null. If a role is current, set currently_working true and end_month and end_year null. For education still in progress, put the expected graduation in grad_month and grad_year.
- Split the name into first_name and last_name as best you can. preferred_name only when the resume shows one (e.g. "Robert (Bob) Smith" -> "Bob").
- birthday only when a date of birth is printed on the resume, as YYYY-MM-DD.
- country_code is ISO 3166-1 alpha-2 (US, GB, NL, DE, ...). Infer it from an address or phone country code when it is unambiguous, otherwise null.
- links: put a linkedin.com URL in linkedin, a github.com URL in github, a personal site or portfolio in portfolio, and the single most relevant other URL in other.
- degree: pick the most specific option that matches ("BSc Computer Science" -> "bs", "MSc" -> "ms", "Bachelor of Engineering" -> "bachelors", "Doctorate" -> "phd"). Unfinished studies with no degree -> "incomplete". The subject goes in major.
- gpa only when a numeric GPA is printed.
- experience type: "internship", "full_time", "part_time" or "contract" when the resume makes it clear, otherwise null.
- description: the role's own bullet points, one per line, each starting with "- ". Keep the candidate's wording.
- projects: personal, academic or open-source projects listed separately from jobs.
- skills: one entry per skill. years only when the resume states years of experience for that skill. favorite false.
- languages: spoken languages only, by name.
- Use null for anything genuinely absent. Do not write "N/A", "Unknown", or an empty string.
- Order experience and education most recent first.`

export async function structureResume(text: string): Promise<ResumeProfile> {
  const c = config()

  const result = await complete({
    model: c.OPENROUTER_RESUME_MODEL,
    system: SYSTEM_PROMPT,
    user: `Extract a structured profile from this resume.\n\n<resume>\n${text.slice(0, 40_000)}\n</resume>`,
    schema: resumeExtractSchema,
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

  // Normalise months/years and the currently_working/end-date invariant once,
  // here, so no later stage has to think about it. Work authorization,
  // self-identification and preferences are the candidate's to state in
  // onboarding — never read off a resume.
  return normalizeProfile({
    ...result.data,
    work_authorization: emptyWorkAuthorization(),
    eeo: emptyEeo(),
    preferences: emptyPreferences()
  })
}

/** A readable profile name, e.g. "Ada Lovelace — Senior Backend Engineer". */
export function suggestProfileName(profile: ResumeProfile): string {
  const name = fullName(profile) || 'Untitled profile'
  const title = currentRole(profile)?.title.trim()
  return title ? `${name} — ${title}` : name
}
