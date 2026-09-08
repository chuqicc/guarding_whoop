import { describe, it, expect } from 'vitest'
import { computeAgreement, cohensKappa, switchEventsOf } from './agreement'
import type { AnnotationDocument, DocumentBucket } from './annotationDocument'
import type { AttackerId } from '../store/useStore'

// ── fixture builder ────────────────────────────────────────────────────────
interface BucketSpec {
  status?: 'active' | 'dead'
  defTeam?: string
  assignments?: Record<number, AttackerId>
}

function doc(annotator: string, spec: Record<string, BucketSpec>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  const keys = Object.keys(spec).map(Number).sort((a, b) => b - a)
  keys.forEach((bucket, i) => {
    const s = spec[String(bucket)]
    buckets.set(bucket, {
      status: s.status ?? 'active',
      defTeam: s.defTeam ?? 'AAA',
      frameStart: i * 12,
      assignments: new Map(
        Object.entries(s.assignments ?? {}).map(([d, a]) => [Number(d), a]),
      ),
      confidence: new Map(),
      shot: false,
      rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: {}, buckets,
  }
}

describe('cohensKappa', () => {
  it('matches a hand-computed value, cross-checked against sklearn', () => {
    // A = 6,6,7,7   B = 6,6,7,6
    // 3 of 4 agree            -> po = 0.75
    // A marginals 6:2 7:2, B marginals 6:3 7:1
    // pe = (2/4)(3/4) + (2/4)(1/4) = 0.5
    // kappa = (0.75 - 0.5) / (1 - 0.5) = 0.5
    // sklearn.metrics.cohen_kappa_score(['6','6','7','7'], ['6','6','7','6']) == 0.5
    const k = cohensKappa([['6', '6'], ['6', '6'], ['7', '7'], ['7', '6']])
    expect(k).toBeCloseTo(0.5, 10)
  })

  it('is 1 for perfect agreement across more than one category', () => {
    expect(cohensKappa([['6', '6'], ['7', '7']])).toBeCloseTo(1, 10)
  })

  it('is 0 when agreement is exactly what chance predicts', () => {
    // A always 6; B split 6/7. po = 0.5; pe = 1*0.5 + 0*0.5 = 0.5 => kappa 0
    expect(cohensKappa([['6', '6'], ['6', '7']])).toBeCloseTo(0, 10)
  })

  it('is null — not 0 — when only one category was ever used', () => {
    // Expected agreement is 1, so the formula divides by zero. That is a real
    // property of the data and must not be displayed as "no agreement".
    expect(cohensKappa([['6', '6'], ['6', '6']])).toBeNull()
  })

  it('is null for no data', () => {
    expect(cohensKappa([])).toBeNull()
  })
})

describe('cell-level agreement and the exclusion rules', () => {
  it('counts agreements and disagreements, with the denominator stated', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 6, 2: 7 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6, 2: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.nAgree).toBe(1)
    expect(r.nDisagree).toBe(1)
    expect(r.nCompared).toBe(2)
    expect(r.rawAgreement).toBeCloseTo(0.5)
  })

  it('treats a cell only one annotator filled as a coverage mismatch, not a disagreement', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 6, 2: 7 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.nCoverageMismatch).toBe(1)
    expect(r.nDisagree).toBe(0)
    expect(r.nCompared).toBe(1)          // excluded from the denominator
    expect(r.cells.find(c => c.defenderId === 2)?.status).toBe('coverage-mismatch')
  })

  it('excludes a bucket either annotator marked dead', () => {
    const a = doc('Alice', { '400': { status: 'dead', assignments: { 1: 6 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 7 } } })
    const r = computeAgreement(a, b)

    expect(r.nDeadExcluded).toBe(1)
    expect(r.nCompared).toBe(0)
    expect(r.nDisagree).toBe(0)
  })

  it('scores dead/live as its own decision rather than ignoring it', () => {
    const a = doc('Alice', { '400': { status: 'dead' }, '399.5': {} })
    const b = doc('Bob',   { '400': {},                 '399.5': {} })
    const r = computeAgreement(a, b)

    expect(r.deadLive.nCompared).toBe(2)
    expect(r.deadLive.agreement).toBeCloseTo(0.5)
  })

  it('flags a defending-team disagreement and excludes those cells', () => {
    const a = doc('Alice', { '400': { defTeam: 'AAA', assignments: { 1: 6 } } })
    const b = doc('Bob',   { '400': { defTeam: 'BBB', assignments: { 1: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.defenseMismatchBuckets).toEqual([400])
    expect(r.nDefenseMismatch).toBe(1)
    expect(r.nCompared).toBe(0)          // a whole possession is misattributed
  })

  it('ignores buckets absent from one file entirely', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 6 } }, '399.5': { assignments: { 1: 6 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.nCompared).toBe(1)
    expect(r.nCoverageMismatch).toBe(0)
  })

  it('treats GUARD_NONE as a real category, distinct from a blank', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 'GUARD_NONE' } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.nDisagree).toBe(1)
    expect(r.marginals.map(m => m.category).sort()).toEqual(['6', 'NONE'])
  })
})

describe('reported alongside the numbers', () => {
  it('publishes the marginals so chance agreement is visible', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 6, 2: 6 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6, 2: 7 } } })
    const r = computeAgreement(a, b)

    expect(r.marginals).toEqual([
      { category: '6', aCount: 2, bCount: 1 },
      { category: '7', aCount: 0, bCount: 1 },
    ])
  })

  it('breaks agreement down per defender', () => {
    const a = doc('Alice', { '400': { assignments: { 1: 6, 2: 7 } },
                             '399.5': { assignments: { 1: 6, 2: 7 } } })
    const b = doc('Bob',   { '400': { assignments: { 1: 6, 2: 6 } },
                             '399.5': { assignments: { 1: 6, 2: 6 } } })
    const r = computeAgreement(a, b)

    expect(r.perDefender.find(d => d.defenderId === 1)?.rawAgreement).toBe(1)
    expect(r.perDefender.find(d => d.defenderId === 2)?.rawAgreement).toBe(0)
  })

  it('states the carry-forward and manual-only caveats explicitly', () => {
    const r = computeAgreement(doc('A', { '400': {} }), doc('B', { '400': {} }))
    expect(r.caveats.join(' ')).toMatch(/carry-forward/i)
    expect(r.caveats.join(' ')).toMatch(/not available/i)
  })

  it('warns when the two files came from different export formats', () => {
    const a = doc('Alice', { '400': {} })
    const b = { ...doc('Bob', { '400': {} }), sourceFormat: 'csv' as const }
    expect(computeAgreement(a, b).caveats.join(' ')).toMatch(/different formats/i)
  })
})

// ── switch events: the metric that actually characterises quality ──────────
describe('switch-event agreement', () => {
  const buckets = ['400', '399.5', '399', '398.5', '398']

  const withSwitchAt = (name: string, switchBucket: number) => {
    const spec: Record<string, BucketSpec> = {}
    for (const b of buckets) {
      const n = Number(b)
      spec[b] = { assignments: { 1: n >= switchBucket ? 6 : 7 } }
    }
    return doc(name, spec)
  }

  it('extracts the bucket where a new assignment begins', () => {
    const d = withSwitchAt('Alice', 399)   // 6 down to 399, then 7
    const allBuckets = buckets.map(Number).sort((x, y) => y - x)
    const frameStart = new Map(allBuckets.map((b, i) => [b, i * 12]))
    expect(switchEventsOf(d, allBuckets, frameStart).get(1)).toEqual([398.5])
  })

  it('counts a switch both annotators saw one bucket apart as a match', () => {
    // Alice says the change begins at 399.0, Bob at 398.5 — one bucket (0.5s).
    // Scoring that as two separate disagreements would be wrong.
    const r = computeAgreement(withSwitchAt('Alice', 399.5), withSwitchAt('Bob', 399))
    expect(r.switchEvents.nA).toBe(1)
    expect(r.switchEvents.nB).toBe(1)
    expect(r.switchEvents.matched).toBe(1)
    expect(r.switchEvents.f1).toBe(1)
    expect(r.switchEvents.medianOffsetBuckets).toBeCloseTo(1)
  })

  it('does not match a switch three buckets apart at the default ±2 tolerance', () => {
    const r = computeAgreement(withSwitchAt('Alice', 400), withSwitchAt('Bob', 398.5))
    expect(r.switchEvents.matched).toBe(0)
    expect(r.switchEvents.f1).toBe(0)
  })

  it('honours a stricter tolerance', () => {
    const strict = computeAgreement(
      withSwitchAt('Alice', 399.5), withSwitchAt('Bob', 399), { toleranceBuckets: 0 },
    )
    expect(strict.switchEvents.matched).toBe(0)
  })

  it('scores an identical pair of files as perfect', () => {
    const r = computeAgreement(withSwitchAt('Alice', 399), withSwitchAt('Bob', 399))
    expect(r.switchEvents.f1).toBe(1)
    expect(r.switchEvents.medianOffsetBuckets).toBe(0)
    expect(r.rawAgreement).toBe(1)
  })

  it('reports a switch only one annotator recorded as unmatched', () => {
    const never: Record<string, BucketSpec> = {}
    for (const b of buckets) never[b] = { assignments: { 1: 6 } }
    const r = computeAgreement(withSwitchAt('Alice', 399), doc('Bob', never))

    expect(r.switchEvents.nA).toBe(1)
    expect(r.switchEvents.nB).toBe(0)
    expect(r.switchEvents.matched).toBe(0)
    expect(r.switchEvents.recall).toBe(0)
  })

  it('does not count a break caused by a dead ball as a switch', () => {
    // Same attacker either side of a stoppage is not a change of target.
    const spec: Record<string, BucketSpec> = {}
    for (const b of buckets) spec[b] = { assignments: { 1: 6 } }
    spec['399'] = { status: 'dead' }
    const d = doc('Alice', spec)

    const allBuckets = buckets.map(Number).sort((x, y) => y - x)
    const frameStart = new Map(allBuckets.map((b, i) => [b, i * 12]))
    expect(switchEventsOf(d, allBuckets, frameStart).get(1)).toEqual([])
  })
})
