import type { ResumeProfile } from '@/lib/resume/profile-schema'

/**
 * Sample persona #1. Entirely fictional (the name is a nod, the career is
 * invented; example.com contacts, Ofcom/ITU drama phone range). Used by the
 * tests (tests/support/seed.ts); the matching PDF is a text-based resume you
 * can upload to try the app.
 */

export const profile = {
  personal: {
    first_name: 'Ada',
    last_name: 'Lovelace',
    preferred_name: null,
    email: 'ada.lovelace@example.com',
    phone: '+442079460958',
    birthday: '1990-12-10',
  },
  location: {
    address: null,
    address_2: null,
    address_3: null,
    city: 'London',
    region: null,
    postal_code: null,
    country_code: 'GB',
    country_name: 'United Kingdom',
  },
  links: {
    linkedin: null,
    github: null,
    portfolio: 'https://ada-lovelace.example.com',
    other: null,
  },
  experience: [
    {
      company: 'Analytical Engines Ltd',
      title: 'Senior Backend Engineer',
      location: 'London, UK',
      type: 'full_time',
      start_month: 3,
      start_year: 2022,
      end_month: null,
      end_year: null,
      currently_working: true,
      description:
        '- Own the job-scheduling platform: a Postgres-backed queue executing 40M tasks/day.\n' +
        '- Designed the idempotency-key contract used by every internal producer, cutting duplicate ' +
        'side effects to zero across three years of incident reports.\n' +
        '- Led a team of four through the migration from cron sprawl to event-driven workers.',
    },
    {
      company: 'Difference Works',
      title: 'Backend Engineer',
      location: 'Remote',
      type: 'full_time',
      start_month: 6,
      start_year: 2019,
      end_month: 2,
      end_year: 2022,
      currently_working: false,
      description:
        '- Built the public REST API (TypeScript, Node.js) for a payroll product used by 900 SMEs.\n' +
        '- Wrote the webhook delivery system, including signing and replay protection.',
    },
    {
      company: 'Jacquard Systems',
      title: 'Software Engineer',
      location: 'Manchester, UK',
      type: 'full_time',
      start_month: 9,
      start_year: 2016,
      end_month: 5,
      end_year: 2019,
      currently_working: false,
      description:
        '- Shipped inventory ingestion pipelines processing supplier feeds in 14 formats.',
    },
  ],
  education: [
    {
      school: 'University of Edinburgh',
      degree: 'bs',
      major: 'Mathematics and Computer Science',
      gpa: null,
      start_month: 9,
      start_year: 2012,
      grad_month: 6,
      grad_year: 2016,
    },
  ],
  projects: [],
  skills: [
    { name: 'TypeScript', years: '5-8', favorite: true },
    { name: 'Node.js', years: '5-8', favorite: false },
    { name: 'PostgreSQL', years: '9+', favorite: true },
    { name: 'Kubernetes', years: null, favorite: false },
    { name: 'Event-driven architecture', years: null, favorite: false },
    { name: 'Terraform', years: null, favorite: false },
  ],
  languages: ['English', 'French'],
  work_authorization: {
    us: false,
    canada: false,
    uk: true,
    other_country_codes: ['NL'],
    requires_sponsorship: false,
  },
  // Explicit answers, so tests cover the self-identification mapping path.
  eeo: {
    gender: 'female',
    ethnicity: ['white'],
    veteran: 'no',
    disability: 'no',
    lgbtq: 'no',
  },
  preferences: {
    job_types: ['full_time'],
    work_setups: ['hybrid'],
    locations: ['London'],
    min_salary: null,
  },
} satisfies ResumeProfile

/** Plain-text resume, matching the checked-in ada-lovelace.pdf. */
export const resumeText = `Ada Lovelace
Senior Backend Engineer · London, United Kingdom
ada.lovelace@example.com · +44 20 7946 0958 · https://ada-lovelace.example.com
Sample profile - a fictional candidate shipped with the Jobo Auto Apply example.

Summary
Backend engineer with nine years of experience building event-driven systems and the
teams that run them. I care about idempotency, boring failure modes, and APIs that
explain themselves. Most at home owning a service end to end, from schema to pager.

Experience
Analytical Engines Ltd - Senior Backend Engineer
March 2022 - present · London, UK
Own the job-scheduling platform: a Postgres-backed queue executing 40M tasks/day.
Designed the idempotency-key contract used by every internal producer, cutting
duplicate side effects to zero across three years of incident reports.
Led a team of four through the migration from cron sprawl to event-driven workers.

Difference Works - Backend Engineer
June 2019 - February 2022 · Remote
Built the public REST API (TypeScript, Node.js) for a payroll product used by 900
SMEs; wrote the webhook delivery system, including signing and replay protection.

Jacquard Systems - Software Engineer
September 2016 - May 2019 · Manchester, UK
Shipped inventory ingestion pipelines processing supplier feeds in 14 formats.

Education
University of Edinburgh - BSc Mathematics and Computer Science, 2012-2016

Skills
TypeScript · Node.js · PostgreSQL · Kubernetes · Event-driven architecture · Terraform
Languages: English (native), French (conversational)

Work authorisation
Authorised to work in the UK and the Netherlands. No sponsorship required.
Notice period: 30 days.
`
