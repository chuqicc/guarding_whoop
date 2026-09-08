import { describe, it, expect } from 'vitest'
import { buildDiffRuns, isReviewable } from './diffRuns'
import type { CellComparison } from './agreement'

const buckets = [400, 399.5, 399, 398.5, 398]

const cell = (
  bucket: number, defenderId: number,
  status: CellComparison['status'],
  a?: CellComparison['a'], b?: CellComparison['b'],
): CellComparison => ({ bucket, defenderId, status, a, b })

describe('buildDiffRuns', () => {
  it('collapses consecutive equal cells into one run', () => {
    const runs = buildDiffRuns([
      cell(400, 1, 'agree', 6, 6),
      cell(399.5, 1, 'agree', 6, 6),
      cell(399, 1, 'agree', 6, 6),
    ], buckets)

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      defenderId: 1, status: 'agree',
      startBucket: 400, endBucket: 399, bucketCount: 3, durationS: 1.5,
    })
  })

  it('splits when the status changes', () => {
    const runs = buildDiffRuns([
      cell(400, 1, 'agree', 6, 6),
      cell(399.5, 1, 'disagree', 6, 7),
      cell(399, 1, 'agree', 6, 6),
    ], buckets)

    expect(runs.map(r => r.status)).toEqual(['agree', 'disagree', 'agree'])
    expect(runs[1].durationS).toBe(0.5)
  })

  it('keeps two different disagreements apart even when adjacent', () => {
    // Merging them would show one bar claiming a single A/B pair that is
    // only true for half of it.
    const runs = buildDiffRuns([
      cell(400, 1, 'disagree', 6, 7),
      cell(399.5, 1, 'disagree', 6, 12),
    ], buckets)

    expect(runs).toHaveLength(2)
    expect(runs.map(r => r.b)).toEqual([7, 12])
  })

  it('breaks a run where buckets are not contiguous', () => {
    const runs = buildDiffRuns([
      cell(400, 1, 'agree', 6, 6),
      // 399.5 missing
      cell(399, 1, 'agree', 6, 6),
    ], buckets)

    expect(runs).toHaveLength(2)
  })

  it('keeps defenders separate', () => {
    const runs = buildDiffRuns([
      cell(400, 1, 'agree', 6, 6),
      cell(400, 2, 'disagree', 7, 6),
    ], buckets)

    expect(runs).toHaveLength(2)
    expect(runs.map(r => r.defenderId).sort()).toEqual([1, 2])
  })

  it('carries the two competing answers so the bar can show them', () => {
    const runs = buildDiffRuns([cell(400, 1, 'disagree', 6, 7)], buckets)
    expect(runs[0]).toMatchObject({ a: 6, b: 7 })
  })

  it('returns nothing for no cells', () => {
    expect(buildDiffRuns([], buckets)).toEqual([])
  })

  it('collapses a long agreeing stretch to a single run — the perf claim', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ b: 400 - i * 0.5 }))
    const order = many.map(m => m.b)
    const cells = many.map(m => cell(m.b, 1, 'agree', 6, 6))
    expect(buildDiffRuns(cells, order)).toHaveLength(1)
  })
})

describe('isReviewable', () => {
  it('marks the statuses a reviewer should step through', () => {
    expect(isReviewable('disagree')).toBe(true)
    expect(isReviewable('coverage-mismatch')).toBe(true)
    expect(isReviewable('defense-mismatch')).toBe(true)
  })

  it('skips agreements and dead-ball exclusions', () => {
    expect(isReviewable('agree')).toBe(false)
    expect(isReviewable('dead-excluded')).toBe(false)
  })
})
