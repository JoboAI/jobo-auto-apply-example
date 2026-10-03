import { describe, expect, it } from 'vitest'
import {
  FACETS,
  filtersCacheKey,
  filtersHref,
  parseFilters,
  toggleHref,
  toggleSigned,
  toggleSignedHref,
  toSearchBody,
} from '@/lib/jobo/job-filters'

const SUPPORTED = ['ashby', 'greenhouse', 'lever']

describe('explorer filters', () => {
  it('parses repeatable params, exclusions and vocabularies', () => {
    const filters = parseFilters({
      q: '  data engineer ',
      loc: ['united states', 'Berlin'],
      co: ['stripe.com', '-meta.com'],
      ind: ['Fintech', '-HR & Staffing'],
      cat: ['SaaS', '-b2c', 'not-a-category'],
      wm: ['remote', 'beach'],
      exp: 'senior',
      emp: 'full-time',
      ats: 'Lever',
      salary: '160000',
      posted: '7d',
      page: '3',
    })
    expect(filters).toMatchObject({
      q: 'data engineer',
      locations: ['united states', 'Berlin'],
      companies: { include: ['stripe.com'], exclude: ['meta.com'] },
      industries: { include: ['Fintech'], exclude: ['HR & Staffing'] },
      categories: { include: ['saas'], exclude: ['b2c'] },
      workModels: ['remote'],
      experienceLevels: ['senior'],
      employmentTypes: ['full-time'],
      sources: ['lever'],
      minSalary: 160000,
      posted: '7d',
      page: 3,
    })
  })

  it('round-trips through its own links', () => {
    const filters = parseFilters({
      q: 'rust',
      co: ['-meta.com'],
      ind: 'Fintech',
      wm: 'remote',
      page: '2',
    })
    const again = parseFilters(
      Object.fromEntries(
        [...new URL(filtersHref(filters), 'https://demo.test').searchParams].reduce(
          (all, [k, v]) => all.set(k, [...(all.get(k) ?? []), v]),
          new Map<string, string[]>(),
        ),
      ),
    )
    expect(again).toEqual(filters)
  })

  it('keeps old ?location= links working', () => {
    expect(parseFilters({ location: 'Toronto' }).locations).toEqual(['Toronto'])
  })

  it('adds a typed company on the side of the button pressed', () => {
    expect(parseFilters({ co: 'stripe.com', co_new: 'meta.com', co_op: '-' }).companies).toEqual({
      include: ['stripe.com'],
      exclude: ['meta.com'],
    })
    expect(parseFilters({ co_new: 'Stripe', co_op: '+' }).companies).toEqual({
      include: ['Stripe'],
      exclude: [],
    })
  })

  it('toggles and always starts over at page one', () => {
    const filters = parseFilters({ wm: 'remote', page: '4' })
    expect(toggleHref(filters, 'workModels', 'hybrid')).toBe('/jobs?wm=remote&wm=hybrid')
    expect(toggleHref(filters, 'workModels', 'Remote')).toBe('/jobs')
  })

  it('never keeps a value on both sides of an include/exclude filter', () => {
    expect(toggleSigned({ include: ['Fintech'], exclude: [] }, 'fintech', 'exclude')).toEqual({
      include: [],
      exclude: ['fintech'],
    })
    expect(toggleSignedHref(parseFilters({ ind: '-Fintech' }), 'industries', 'Fintech')).toBe(
      '/jobs?ind=Fintech',
    )
  })

  it('maps to the POST /api/jobs/search body', () => {
    const now = new Date('2026-10-02T12:34:56Z')
    const body = toSearchBody(
      parseFilters({
        ats: ['lever', 'icims'],
        posted: '24h',
        salary: '120000',
        skill: 'Python',
        page: '2',
      }),
      SUPPORTED,
      25,
      now,
    )
    expect(body).toEqual({
      sources: ['lever'],
      skills: { include: ['Python'] },
      salary_usd: { min: 120000 },
      posted_after: '2026-10-01T12:00:00.000Z',
      include_facets: [...FACETS],
      page: 2,
      page_size: 25,
    })
  })

  it('searches every supported ATS when no supported one is picked', () => {
    expect(toSearchBody(parseFilters({ ats: 'icims' }), SUPPORTED, 25).sources).toEqual(SUPPORTED)
  })

  it('caches by meaning, not by spelling or order', () => {
    const a = parseFilters({ wm: ['remote', 'hybrid'], ind: 'Fintech' })
    const b = parseFilters({ ind: 'fintech', wm: ['hybrid', 'remote'] })
    expect(filtersCacheKey(a)).toBe(filtersCacheKey(b))
    expect(filtersCacheKey(a)).not.toBe(filtersCacheKey(parseFilters({ wm: 'remote' })))
    expect(filtersCacheKey(a)).not.toBe(filtersCacheKey({ ...a, page: 2 }))
  })
})
