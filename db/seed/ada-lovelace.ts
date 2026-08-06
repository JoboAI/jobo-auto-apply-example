import type { ResumeProfile } from '@/lib/resume/profile-schema'

/**
 * Sample persona #1. Entirely fictional (the name is a nod, the career is
 * invented; example.com contacts, Ofcom/ITU drama phone range). Ships with the
 * example so the tutorial's profile dropdown is never empty — see db/seed.ts.
 */

export const profile = {
  personal: {
    full_name: 'Ada Lovelace',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada.lovelace@example.com',
    phone: '+442079460958',
    headline: 'Senior Backend Engineer',
    pronouns: null
  },
  location: {
    line1: null,
    line2: null,
    city: 'London',
    region: null,
    postal_code: null,
    country_code: 'GB',
    country_name: 'United Kingdom'
  },
  links: [{ label: 'Portfolio', type: 'portfolio', url: 'https://ada-lovelace.example.com' }],
  work_experience: [
    {
      company: 'Analytical Engines Ltd',
      title: 'Senior Backend Engineer',
      employment_type: 'Full-time',
      location: 'London, UK',
      start_date: '2022-03',
      end_date: null,
      is_current: true,
      description:
        'Owns the job-scheduling platform, a Postgres-backed queue executing 40M tasks a day. ' +
        'Designed the idempotency-key contract used by every internal producer, cutting duplicate ' +
        'side effects to zero across three years of incident reports. Leads a team of four.'
    },
    {
      company: 'Difference Works',
      title: 'Backend Engineer',
      employment_type: 'Full-time',
      location: 'Remote',
      start_date: '2019-06',
      end_date: '2022-02',
      is_current: false,
      description:
        'Built the public REST API (TypeScript, Node.js) for a payroll product used by 900 SMEs. ' +
        'Wrote the webhook delivery system, including signing and replay protection.'
    },
    {
      company: 'Jacquard Systems',
      title: 'Software Engineer',
      employment_type: 'Full-time',
      location: 'Manchester, UK',
      start_date: '2016-09',
      end_date: '2019-05',
      is_current: false,
      description:
        'Shipped inventory ingestion pipelines processing supplier feeds in 14 formats, with ' +
        'schema validation and quarantine flows that kept bad data out of the warehouse.'
    }
  ],
  education: [
    {
      school: 'University of Edinburgh',
      degree: 'BSc',
      field_of_study: 'Mathematics and Computer Science',
      start_date: '2012-09',
      end_date: '2016-06',
      is_current: false,
      grade: null
    }
  ],
  skills: [
    { name: 'TypeScript', level: 'Expert' },
    { name: 'Node.js', level: 'Expert' },
    { name: 'PostgreSQL', level: 'Expert' },
    { name: 'Kubernetes', level: 'Proficient' },
    { name: 'Event-driven architecture', level: 'Expert' },
    { name: 'Terraform', level: 'Familiar' }
  ],
  languages: [
    { name: 'English', proficiency: 'Native' },
    { name: 'French', proficiency: 'Conversational' }
  ],
  certifications: [],
  work_authorization: {
    authorized_country_codes: ['GB', 'NL'],
    requires_sponsorship: false,
    notice_period_days: 30
  },
  preferences: {
    desired_salary: null,
    salary_currency: null,
    willing_to_relocate: false,
    remote_preference: 'hybrid',
    earliest_start_date: null
  },
  about: {
    summary:
      'I am a backend engineer with nine years of experience building event-driven systems and ' +
      'the teams that run them. I care about idempotency, boring failure modes, and APIs that ' +
      'explain themselves.',
    motivation:
      'I am looking for a senior backend role at a product company where reliability is a ' +
      'feature, not an afterthought — ideally owning a service end to end, from schema design ' +
      'to the pager. I do my best work on small teams that ship deliberately.',
    strengths: [
      'Idempotent API and queue design',
      'Postgres at scale',
      'Incident analysis and prevention',
      'Mentoring mid-level engineers',
      'Writing documentation people actually read'
    ],
    notable_projects: [
      'A Postgres-backed job scheduler executing 40M tasks/day with exactly-once side effects.',
      'A signed webhook delivery system with replay protection for a payroll product.',
      'Migration of a cron-sprawl estate to event-driven workers with zero missed jobs.'
    ],
    freeform_notes:
      'Happy to talk through the job scheduler design in depth — the idempotency-key contract ' +
      'is the part I am proudest of, because it turned a class of recurring incidents into a ' +
      'non-event. I prefer hybrid working from London, up to two office days a week. I can ' +
      'start after a 30-day notice period. Salary expectations are negotiable and depend on ' +
      'the overall package. For "why do you want to work here" style questions: I am drawn to ' +
      'products where correctness matters to the customer — payments, infrastructure, ' +
      'developer tools — and to teams that write things down.'
  }
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
