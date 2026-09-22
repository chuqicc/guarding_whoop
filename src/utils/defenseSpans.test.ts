import { describe, it, expect } from 'vitest'
import { compareDefenseSpans } from './defenseSpans'
import type { AnnotationDocument, DocumentBucket } from './annotationDocument'

const WINDOW = [400, 399.5, 399, 398.5, 398, 397.5]

/** `teams` maps bucket -> defending team; omit a bucket to leave it unlabelled. */
function doc(annotator: string, teams: Record<number, string | undefined>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: 'active',
      defTeam: teams[bucket],
      frameStart: i,
      assignments: new Map(),
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

/** Every bucket on one team, except the listed overrides. */
const all = (team: string, override: Record<number, string | undefined> = {}) => {
  const out: Record<number, string | undefined> = {}
  for (const b of WINDOW) out[b] = team
  return { ...out, ...override }
}

const sideSpans = (r: ReturnType<typeof compareDefenseSpans>, side: 'a' | 'b') =>
  r.spans.filter(s => s.side === side)

describe('merging into spans', () => {
  it('merges consecutive same-team buckets into one span', () => {
    const r = compareDefenseSpans(doc('A', all('AAA')), doc('B', all('AAA')))
    const a = sideSpans(r, 'a')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({
      team: 'AAA', startBucket: 400, endBucket: 397.5, bucketCount: 6, durationS: 3,
    })
  })

  it('splits where the defending team changes', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA', { 399: 'BBB', 398.5: 'BBB' })),
      doc('B', all('AAA')),
    )
    const a = sideSpans(r, 'a')
    expect(a.map(s => s.team)).toEqual(['AAA', 'BBB', 'AAA'])
  })

  it('counts how much of a span the other annotator agreed with', () => {
    // A says AAA throughout; B switches to BBB for two buckets.
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('AAA', { 399: 'BBB', 398.5: 'BBB' })),
    )
    expect(sideSpans(r, 'a')[0].agreedBuckets).toBe(4)
  })

  it('leaves unlabelled buckets out of every span', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA', { 399: undefined })),
      doc('B', all('AAA')),
    )
    // The hole splits A's run in two and is itself in neither.
    const a = sideSpans(r, 'a')
    expect(a).toHaveLength(2)
    expect(a.reduce((n, s) => n + s.bucketCount, 0)).toBe(5)
  })

  it('carries frameStart so a span can be replayed', () => {
    const r = compareDefenseSpans(doc('A', all('AAA')), doc('B', all('AAA')))
    expect(sideSpans(r, 'a')[0].frameStart).toBe(0)
  })
})

describe('disagreement regions', () => {
  it('merges a contiguous clash into one region', () => {
    // A 1.5s stretch is one possession-level problem, not three.
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('AAA', { 399.5: 'BBB', 399: 'BBB', 398.5: 'BBB' })),
    )
    expect(r.disagreements).toHaveLength(1)
    expect(r.disagreements[0]).toMatchObject({
      startBucket: 399.5, endBucket: 398.5, bucketCount: 3, durationS: 1.5,
      teamA: 'AAA', teamB: 'BBB',
    })
  })

  it('records which team each annotator named', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('BBB')),
    )
    expect(r.disagreements[0]).toMatchObject({ teamA: 'AAA', teamB: 'BBB' })
  })

  it('treats a missing label as a gap, not a clash', () => {
    // Only one side named a team — that is incomplete work, not a conflict.
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('AAA', { 399: undefined })),
    )
    expect(r.disagreements).toEqual([])
    expect(r.counts.missing).toBe(1)
    expect(r.counts.disagree).toBe(0)
  })

  it('breaks a region when the pair of teams changes', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA', { 399: 'BBB' })),
      doc('B', all('BBB', { 399: 'AAA' })),
    )
    expect(r.disagreements.length).toBeGreaterThan(1)
  })

  it('returns nothing when the two agree throughout', () => {
    const r = compareDefenseSpans(doc('A', all('AAA')), doc('B', all('AAA')))
    expect(r.disagreements).toEqual([])
  })

  it('carries frameStart for jumping to the play', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('AAA', { 399: 'BBB' })),
    )
    expect(r.disagreements[0].frameStart).toBe(2)   // third bucket in the window
  })
})

describe('counts and teams', () => {
  it('sums to the number of comparable buckets', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA', { 399: undefined })),
      doc('B', all('AAA', { 398: 'BBB' })),
    )
    const { agree, disagree, missing } = r.counts
    expect(agree + disagree + missing).toBe(r.orderedBuckets.length)
  })

  it('lists every team either annotator named, for stable colouring', () => {
    const r = compareDefenseSpans(
      doc('A', all('AAA')),
      doc('B', all('BBB')),
    )
    expect(r.teams).toEqual(['AAA', 'BBB'])
  })

  it('compares only buckets present in both files', () => {
    const a = doc('A', all('AAA'))
    const b = doc('B', all('AAA'))
    b.buckets.delete(397.5)
    const r = compareDefenseSpans(a, b)
    expect(r.orderedBuckets).not.toContain(397.5)
    expect(r.orderedBuckets).toHaveLength(5)
  })

  it('handles two files with no overlap', () => {
    const a = doc('A', all('AAA'))
    const b = doc('B', all('AAA'))
    for (const k of [...b.buckets.keys()]) b.buckets.delete(k)
    const r = compareDefenseSpans(a, b)
    expect(r.orderedBuckets).toEqual([])
    expect(r.spans).toEqual([])
    expect(r.disagreements).toEqual([])
  })
})
