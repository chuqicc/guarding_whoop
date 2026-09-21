import { describe, it, expect } from 'vitest'
import { compareDeadSpans } from './deadSpans'
import type { AnnotationDocument, DocumentBucket } from './annotationDocument'
import type { AttackerId } from '../store/useStore'

interface Spec {
  dead?: boolean
  assignments?: Record<number, AttackerId>
}

/** Buckets are given newest-clock-first; frameStart is assigned in that order. */
function doc(annotator: string, spec: Record<string, Spec>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  const keys = Object.keys(spec).map(Number).sort((a, b) => b - a)
  keys.forEach((bucket, i) => {
    const s = spec[String(bucket)]
    buckets.set(bucket, {
      status: s.dead ? 'dead' : 'active',
      defTeam: 'AAA',
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

/** Shorthand: which buckets each side called dead, over a fixed window. */
const window = [400, 399.5, 399, 398.5, 398, 397.5]
function fromDeadList(annotator: string, dead: number[], extra: Record<string, Spec> = {}) {
  const spec: Record<string, Spec> = {}
  for (const b of window) spec[String(b)] = { dead: dead.includes(b), ...extra[String(b)] }
  return doc(annotator, spec)
}

const sideSpans = (r: ReturnType<typeof compareDeadSpans>, side: 'a' | 'b') =>
  r.spans.filter(s => s.side === side)

describe('merging dead buckets into spans', () => {
  it('merges consecutive dead buckets into one span', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [399.5, 399, 398.5]),
      fromDeadList('B', [399.5, 399, 398.5]),
    )
    const a = sideSpans(r, 'a')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({
      startBucket: 399.5, endBucket: 398.5, bucketCount: 3, durationS: 1.5,
    })
  })

  it('does NOT fragment a stoppage when the carried-forward attacker changes', () => {
    // The grid splits runs on attacker identity, which is meaningless for a
    // status that has nothing to do with who was being guarded.
    const a = fromDeadList('A', [399.5, 399, 398.5], {
      '399.5': { assignments: { 1: 6 } },
      '399':   { assignments: { 1: 7 } },   // attacker changed underneath
      '398.5': { assignments: { 1: 7 } },
    })
    const r = compareDeadSpans(a, fromDeadList('B', [399.5, 399, 398.5]))
    expect(sideSpans(r, 'a')).toHaveLength(1)
  })

  it('produces a span for a dead bucket nobody annotated', () => {
    // The agreement cells only exist where someone recorded an assignment, so
    // this case used to leave a hole in the grid.
    const r = compareDeadSpans(
      fromDeadList('A', [399.5, 399]),      // no assignments anywhere
      fromDeadList('B', [399.5, 399]),
    )
    expect(sideSpans(r, 'a')).toHaveLength(1)
    expect(sideSpans(r, 'a')[0].bucketCount).toBe(2)
  })

  it('splits when dead buckets are not adjacent', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [399.5, 398.5]),    // 399 is live between them
      fromDeadList('B', []),
    )
    expect(sideSpans(r, 'a')).toHaveLength(2)
  })

  it('carries frameStart so a span can be replayed', () => {
    const r = compareDeadSpans(fromDeadList('A', [399.5]), fromDeadList('B', []))
    expect(sideSpans(r, 'a')[0].frameStart).toBe(12)   // second bucket in the window
  })
})

describe('boundary disagreement — the common case', () => {
  it('keeps both sides as separate spans and counts the overlap', () => {
    // A stops the clock two buckets earlier than B, then both end together.
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 399, 398.5]),
      fromDeadList('B', [399, 398.5]),
    )
    const a = sideSpans(r, 'a')[0]
    const b = sideSpans(r, 'b')[0]

    expect(a).toMatchObject({ startBucket: 400, endBucket: 398.5, bucketCount: 4 })
    expect(b).toMatchObject({ startBucket: 399, endBucket: 398.5, bucketCount: 2 })
    expect(a.agreedBuckets).toBe(2)     // only the tail overlaps
    expect(b.agreedBuckets).toBe(2)
  })

  it('distinguishes a missed stoppage from a boundary offset', () => {
    const missed = compareDeadSpans(
      fromDeadList('A', [399.5, 399]),
      fromDeadList('B', []),
    )
    expect(sideSpans(missed, 'a')[0].agreedBuckets).toBe(0)   // nothing overlaps
    expect(sideSpans(missed, 'b')).toHaveLength(0)

    const offset = compareDeadSpans(
      fromDeadList('A', [399.5, 399]),
      fromDeadList('B', [399, 398.5]),
    )
    expect(sideSpans(offset, 'a')[0].agreedBuckets).toBe(1)   // partial overlap
    expect(sideSpans(offset, 'b')[0].agreedBuckets).toBe(1)
  })
})

describe('confusion matrix keeps the direction', () => {
  it('separates aOnly from bOnly', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5]),
      fromDeadList('B', [399.5, 399]),
    )
    expect(r.confusion).toEqual({
      bothDead: 1,     // 399.5
      aOnly: 1,        // 400
      bOnly: 1,        // 399
      bothActive: 3,   // 398.5, 398, 397.5
    })
  })

  it('sums to the number of comparable buckets', () => {
    const r = compareDeadSpans(fromDeadList('A', [399.5]), fromDeadList('B', [399]))
    const { bothDead, aOnly, bOnly, bothActive } = r.confusion
    expect(bothDead + aOnly + bOnly + bothActive).toBe(r.orderedBuckets.length)
  })
})

describe('usage — catching a file that never marked dead at all', () => {
  it('reports zero for a side with no dead marks', () => {
    // A CSV missing the gamestatus column parses as all-active, which would
    // otherwise read as perfect agreement.
    const r = compareDeadSpans(fromDeadList('A', [399.5, 399]), fromDeadList('B', []))
    expect(r.usage).toEqual({ a: 2, b: 0 })
  })

  it('counts every dead bucket a side marked, agreed or not', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5]),
      fromDeadList('B', [399.5]),
    )
    expect(r.usage).toEqual({ a: 2, b: 1 })
  })
})

describe('only overlapping buckets are compared', () => {
  it('ignores buckets present in just one file', () => {
    const a = doc('A', { '400': { dead: true }, '399.5': { dead: true } })
    const b = doc('B', { '400': { dead: true } })          // 399.5 absent
    const r = compareDeadSpans(a, b)

    expect(r.orderedBuckets).toEqual([400])
    expect(r.confusion.bothDead).toBe(1)
    expect(sideSpans(r, 'a')[0].bucketCount).toBe(1)       // 399.5 not counted
  })

  it('handles two files with no overlap at all', () => {
    const r = compareDeadSpans(
      doc('A', { '400': { dead: true } }),
      doc('B', { '300': { dead: true } }),
    )
    expect(r.orderedBuckets).toEqual([])
    expect(r.spans).toEqual([])
  })
})

describe('disagreement regions — the unit a reviewer steps through', () => {
  it('merges a contiguous stretch into one region, not one per bucket', () => {
    // A 1.5s boundary offset is one thing to look at, not three.
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 399, 398.5]),
      fromDeadList('B', [398.5]),
    )
    expect(r.disagreements).toHaveLength(1)
    expect(r.disagreements[0]).toMatchObject({
      startBucket: 400, endBucket: 399, bucketCount: 3, durationS: 1.5, deadSide: 'a',
    })
  })

  it('records which side called it dead', () => {
    const aSide = compareDeadSpans(fromDeadList('A', [399.5]), fromDeadList('B', []))
    expect(aSide.disagreements[0].deadSide).toBe('a')

    const bSide = compareDeadSpans(fromDeadList('A', []), fromDeadList('B', [399.5]))
    expect(bSide.disagreements[0].deadSide).toBe('b')
  })

  it('splits into two regions when a shared stoppage is offset at both ends', () => {
    // A: 400 .. 399   B: 399.5 .. 398.5  -> A-only head, B-only tail
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 399]),
      fromDeadList('B', [399.5, 399, 398.5]),
    )
    expect(r.disagreements).toHaveLength(2)
    expect(r.disagreements[0]).toMatchObject({ startBucket: 400, deadSide: 'a' })
    expect(r.disagreements[1]).toMatchObject({ startBucket: 398.5, deadSide: 'b' })
  })

  it('breaks a region when the direction flips without a gap', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400]),
      fromDeadList('B', [399.5]),
    )
    expect(r.disagreements.map(d => d.deadSide)).toEqual(['a', 'b'])
  })

  it('returns nothing when the two agree everywhere', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [399.5, 399]),
      fromDeadList('B', [399.5, 399]),
    )
    expect(r.disagreements).toEqual([])
  })

  it('carries frameStart so the region can be replayed', () => {
    const r = compareDeadSpans(fromDeadList('A', [399]), fromDeadList('B', []))
    expect(r.disagreements[0].frameStart).toBe(24)   // third bucket in the window
  })

  it('counts the same buckets the confusion matrix does', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5]),
      fromDeadList('B', [399.5, 399]),
    )
    const total = r.disagreements.reduce((n, d) => n + d.bucketCount, 0)
    expect(total).toBe(r.confusion.aOnly + r.confusion.bOnly)
  })
})

describe('cumulative series — what shows systematic bias', () => {
  it('runs in the same order and length as the buckets', () => {
    const r = compareDeadSpans(fromDeadList('A', [399.5]), fromDeadList('B', [399]))
    expect(r.series.map(p => p.bucket)).toEqual(r.orderedBuckets)
  })

  it('never decreases', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 398]),
      fromDeadList('B', [399.5, 399]),
    )
    for (let i = 1; i < r.series.length; i++) {
      expect(r.series[i].cumA).toBeGreaterThanOrEqual(r.series[i - 1].cumA)
      expect(r.series[i].cumB).toBeGreaterThanOrEqual(r.series[i - 1].cumB)
    }
  })

  it('ends at each annotator total dead time in seconds', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 399]),
      fromDeadList('B', [399]),
    )
    const last = r.series[r.series.length - 1]
    expect(last.cumA).toBeCloseTo(r.usage.a * 0.5, 6)
    expect(last.cumB).toBeCloseTo(r.usage.b * 0.5, 6)
    expect(last.cumA).toBe(1.5)
    expect(last.cumB).toBe(0.5)
  })

  it('keeps the two lines identical when the annotators agree throughout', () => {
    const r = compareDeadSpans(
      fromDeadList('A', [399.5, 399]),
      fromDeadList('B', [399.5, 399]),
    )
    for (const p of r.series) expect(p.cumA).toBe(p.cumB)
  })

  it('spreads the lines by the net bias when one over-calls', () => {
    // The point of the chart: a rate that stays 50% looks like noise, but a
    // gap that only ever grows is a systematic difference.
    const r = compareDeadSpans(
      fromDeadList('A', [400, 399.5, 399, 398.5]),
      fromDeadList('B', [399]),
    )
    const last = r.series[r.series.length - 1]
    expect(last.cumA - last.cumB).toBeCloseTo((4 - 1) * 0.5, 6)
  })

  it('records each side state per bucket', () => {
    const r = compareDeadSpans(fromDeadList('A', [399.5]), fromDeadList('B', []))
    const at = r.series.find(p => p.bucket === 399.5)!
    expect(at).toMatchObject({ aDead: true, bDead: false })
  })

  it('is empty when the files share no buckets', () => {
    const a = doc('A', { '400': { dead: true } })
    const b = doc('B', { '300': { dead: true } })
    expect(compareDeadSpans(a, b).series).toEqual([])
  })
})
