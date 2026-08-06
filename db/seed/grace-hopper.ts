import type { ResumeProfile } from '@/lib/resume/profile-schema'

/**
 * Sample persona #2. Entirely fictional (the name is a nod, the career is
 * invented; example.com contacts, 555-01xx fictional phone range). Ships with
 * the example so the tutorial's profile dropdown is never empty — db/seed.ts.
 */

export const profile = {
  personal: {
    full_name: 'Grace Hopper',
    first_name: 'Grace',
    last_name: 'Hopper',
    email: 'grace.hopper@example.com',
    phone: '+12025550143',
    headline: 'Staff Platform Engineer',
    pronouns: null
  },
  location: {
    line1: null,
    line2: null,
    city: 'New York',
    region: 'NY',
    postal_code: null,
    country_code: 'US',
    country_name: 'United States'
  },
  links: [{ label: 'Portfolio', type: 'portfolio', url: 'https://grace-hopper.example.com' }],
  work_experience: [
    {
      company: 'Compiler Works',
      title: 'Staff Platform Engineer',
      employment_type: 'Full-time',
      location: 'Remote (US)',
      start_date: '2021-01',
      end_date: null,
      is_current: true,
      description:
        'Runs the platform group (6 engineers) for a 200-engineer organisation: the Kubernetes ' +
        'fleet, CI/CD, and an internal developer portal that cut service-bootstrap time from ' +
        'two weeks to one afternoon. Halved compute spend with bin-packing and spot pools.'
    },
    {
      company: 'Flowmatic',
      title: 'Senior Site Reliability Engineer',
      employment_type: 'Full-time',
      location: 'New York, NY',
      start_date: '2017-04',
      end_date: '2020-12',
      is_current: false,
      description:
        'Owned reliability for the payments path (99.99% SLO). Introduced error budgets, ' +
        'progressive rollouts, and the incident-review culture the company still uses.'
    },
    {
      company: 'Mark One Systems',
      title: 'Systems Engineer',
      employment_type: 'Full-time',
      location: 'Philadelphia, PA',
      start_date: '2013-08',
      end_date: '2017-03',
      is_current: false,
      description:
        'Automated a bare-metal fleet of 800 hosts with configuration management and PXE ' +
        'provisioning, taking rebuild time from days to under an hour.'
    }
  ],
  education: [
    {
      school: 'Rensselaer Polytechnic Institute',
      degree: 'BSc',
      field_of_study: 'Applied Mathematics',
      start_date: '2009-09',
      end_date: '2013-05',
      is_current: false,
      grade: null
    }
  ],
  skills: [
    { name: 'Go', level: 'Expert' },
    { name: 'Kubernetes', level: 'Expert' },
    { name: 'Terraform', level: 'Expert' },
    { name: 'Observability (Prometheus, OpenTelemetry)', level: 'Proficient' },
    { name: 'CI/CD', level: 'Expert' },
    { name: 'Linux', level: 'Expert' }
  ],
  languages: [{ name: 'English', proficiency: 'Native' }],
  certifications: [
    { name: 'Certified Kubernetes Administrator', issuer: 'CNCF', issued: '2022-05' }
  ],
  work_authorization: {
    authorized_country_codes: ['US'],
    requires_sponsorship: false,
    notice_period_days: 14
  },
  preferences: {
    desired_salary: null,
    salary_currency: null,
    willing_to_relocate: false,
    remote_preference: 'remote',
    earliest_start_date: null
  },
  about: {
    summary:
      'I am a platform engineer with twelve years across SRE and infrastructure. I build paved ' +
      'roads: golden-path pipelines, observability that answers questions, and deploys nobody ' +
      'fears.',
    motivation:
      'I am looking for a staff-level platform or infrastructure role, fully remote, at a ' +
      'company that treats internal tooling as a product with users. I like deleting more ' +
      'code than I write and documenting the rest.',
    strengths: [
      'Kubernetes fleet operations',
      'Developer-experience tooling',
      'SLOs and error budgets',
      'Cost optimisation',
      'Incident command'
    ],
    notable_projects: [
      'An internal developer portal that cut service-bootstrap time from two weeks to one afternoon.',
      'A bin-packing and spot-pool strategy that halved compute spend for a 200-engineer org.',
      'The error-budget and progressive-rollout practice for a 99.99% SLO payments path.'
    ],
    freeform_notes:
      'Remote only — I am based in New York and travel quarterly for team weeks. Two weeks of ' +
      'notice. For open-ended questions: my favourite work is turning a recurring toil into a ' +
      'platform capability, and I evaluate companies by how they run incident reviews. I hold ' +
      'a current CKA. Salary expectations depend on equity mix and are negotiable.'
  }
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
