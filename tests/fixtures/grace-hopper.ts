import type { ResumeProfile } from '@/lib/resume/profile-schema'

/**
 * Sample persona #2. Entirely fictional (the name is a nod, the career is
 * invented; example.com contacts, 555-01xx fictional phone range). Used by the
 * tests (tests/support/seed.ts); the matching PDF is a text-based resume you
 * can upload to try the app.
 */

export const profile = {
  personal: {
    first_name: 'Grace',
    last_name: 'Hopper',
    preferred_name: null,
    email: 'grace.hopper@example.com',
    phone: '+12025550143',
    birthday: null,
  },
  location: {
    address: null,
    address_2: null,
    address_3: null,
    city: 'New York',
    region: 'NY',
    postal_code: null,
    country_code: 'US',
    country_name: 'United States',
  },
  links: {
    linkedin: null,
    github: null,
    portfolio: 'https://grace-hopper.example.com',
    other: null,
  },
  experience: [
    {
      company: 'Compiler Works',
      title: 'Staff Platform Engineer',
      location: 'Remote (US)',
      type: 'full_time',
      start_month: 1,
      start_year: 2021,
      end_month: null,
      end_year: null,
      currently_working: true,
      description:
        '- Run the platform group (6 engineers) for a 200-engineer organisation: the Kubernetes ' +
        'fleet, CI/CD, and an internal developer portal.\n' +
        '- Cut service-bootstrap time from two weeks to one afternoon.\n' +
        '- Halved compute spend with bin-packing and spot pools.',
    },
    {
      company: 'Flowmatic',
      title: 'Senior Site Reliability Engineer',
      location: 'New York, NY',
      type: 'full_time',
      start_month: 4,
      start_year: 2017,
      end_month: 12,
      end_year: 2020,
      currently_working: false,
      description:
        '- Owned reliability for the payments path (99.99% SLO).\n' +
        '- Introduced error budgets, progressive rollouts, and the incident-review culture the ' +
        'company still uses.',
    },
    {
      company: 'Mark One Systems',
      title: 'Systems Engineer',
      location: 'Philadelphia, PA',
      type: 'full_time',
      start_month: 8,
      start_year: 2013,
      end_month: 3,
      end_year: 2017,
      currently_working: false,
      description:
        '- Automated a bare-metal fleet of 800 hosts with configuration management and PXE ' +
        'provisioning, taking rebuild time from days to under an hour.',
    },
  ],
  education: [
    {
      school: 'Rensselaer Polytechnic Institute',
      degree: 'bs',
      major: 'Applied Mathematics',
      gpa: null,
      start_month: 9,
      start_year: 2009,
      grad_month: 5,
      grad_year: 2013,
    },
  ],
  projects: [],
  skills: [
    { name: 'Go', years: '5-8', favorite: true },
    { name: 'Kubernetes', years: '5-8', favorite: true },
    { name: 'Terraform', years: null, favorite: false },
    { name: 'Observability (Prometheus, OpenTelemetry)', years: null, favorite: false },
    { name: 'CI/CD', years: null, favorite: false },
    { name: 'Linux', years: '9+', favorite: false },
  ],
  languages: ['English'],
  work_authorization: {
    us: true,
    canada: false,
    uk: false,
    other_country_codes: [],
    requires_sponsorship: false,
  },
  // Declines every self-identification question — the other path.
  eeo: {
    gender: 'decline',
    ethnicity: ['decline'],
    veteran: 'decline',
    disability: 'decline',
    lgbtq: 'decline',
  },
  preferences: {
    job_types: ['full_time', 'contract'],
    work_setups: ['remote'],
    locations: ['Remote (US)'],
    min_salary: 220000,
  },
} satisfies ResumeProfile

/** Plain-text resume, matching the checked-in grace-hopper.pdf. */
export const resumeText = `Grace Hopper
Staff Platform Engineer · New York, NY, United States
grace.hopper@example.com · +1 202 555 0143 · https://grace-hopper.example.com
Sample profile - a fictional candidate shipped with the Jobo Auto Apply example.

Summary
Platform engineer with twelve years across SRE and infrastructure. I build paved
roads: golden-path pipelines, observability that answers questions, and deploys
nobody fears. I like deleting more code than I write and documenting the rest.

Experience
Compiler Works - Staff Platform Engineer
January 2021 - present · Remote (US)
Run the platform group (6 engineers) for a 200-engineer org: Kubernetes fleet,
CI/CD, and an internal developer portal that cut service-bootstrap time from two
weeks to one afternoon. Halved compute spend with bin-packing and spot pools.

Flowmatic - Senior Site Reliability Engineer
April 2017 - December 2020 · New York, NY
Owned reliability for the payments path (99.99% SLO). Introduced error budgets,
progressive rollouts, and the incident-review culture the company still uses.

Mark One Systems - Systems Engineer
August 2013 - March 2017 · Philadelphia, PA
Automated a bare-metal fleet of 800 hosts with config management and PXE.

Education
Rensselaer Polytechnic Institute - BSc Applied Mathematics, 2009-2013

Skills
Go · Kubernetes · Terraform · Observability (Prometheus, OpenTelemetry) · CI/CD · Linux
Certifications: Certified Kubernetes Administrator (CNCF, 2022)
Languages: English (native)

Work authorisation
US citizen - authorised to work in the United States. No sponsorship required.
Notice period: 2 weeks.
`
