import { describe, it, expect } from 'vitest'
import { computeMarkingSpells, summariseSpells, type SpellInput } from './spells'
import type { CellAnnotation } from '../store/useStore'

// Quarter clock counts DOWN, so buckets descend: 400.0, 399.5, 399.0, ...
const buckets = [400.0, 399.5, 399.0, 398.5, 398.0, 397.5, 397.0]
// One frame per bucket, 25fps => 12 frames per 0.5s bucket
const frameStart = new Map(buckets.map((b, i) => [b, i * 12]))

let n = 0
const cell = (defenderId: number, attackerId: CellAnnotation['attackerId'], bucket: number,
              confidence?: 1 | 2 | 3): CellAnnotation =>
  ({ id: `c${n++}`, defenderId, attackerId, shotClockBucket: bucket, confidence })

const base = (cells: CellAnnotation[], over: Partial<SpellInput> = {}): SpellInput => ({
  cellAnnotations: cells,
  allBuckets: buckets,
  deadTimeBuckets: [],
  memoryBarrierFrames: [],
  bucketFrameStart: frameStart,
  ...over,
})

describe('computeMarkingSpells', () => {
  it('merges consecutive buckets on the same attacker into one spell', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0), cell(1, 6, 399.5), cell(1, 6, 399.0),
    ]))
    expect(spells).toHaveLength(1)
    expect(spells[0]).toMatchObject({
      defenderId: 1, attackerId: 6,
      startBucket: 400.0, endBucket: 399.0,
      bucketCount: 3, durationS: 1.5, endedBy: 'end',
    })
  })

  it('splits when the defender switches attacker, and says so', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0), cell(1, 6, 399.5),
      cell(1, 7, 399.0), cell(1, 7, 398.5),
    ]))
    expect(spells).toHaveLength(2)
    expect(spells[0]).toMatchObject({ attackerId: 6, durationS: 1.0, endedBy: 'switch' })
    expect(spells[1]).toMatchObject({ attackerId: 7, durationS: 1.0, endedBy: 'end' })
  })

  it('treats an unannotated bucket in the middle as a gap, not a continuation', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0),
      // 399.5 has tracking data but was never annotated
      cell(1, 6, 399.0),
    ]))
    expect(spells).toHaveLength(2)
    expect(spells[0].endedBy).toBe('gap')
  })

  it('breaks a spell across a dead ball even when the assignment is unchanged', () => {
    const spells = computeMarkingSpells(base(
      [cell(1, 6, 400.0), cell(1, 6, 399.0)],
      { deadTimeBuckets: [399.5] },
    ))
    expect(spells).toHaveLength(2)
    expect(spells[0].endedBy).toBe('dead-ball')
  })

  it('breaks a spell across a defence swap even when adjacent and unchanged', () => {
    // barrier at frame 12 == the start of bucket 399.5
    const spells = computeMarkingSpells(base(
      [cell(1, 6, 400.0), cell(1, 6, 399.5)],
      { memoryBarrierFrames: [12] },
    ))
    expect(spells).toHaveLength(2)
    expect(spells[0].endedBy).toBe('swap')
  })

  it('keeps GUARD_NONE as a spell in its own right', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 'GUARD_NONE', 400.0), cell(1, 'GUARD_NONE', 399.5),
    ]))
    expect(spells).toHaveLength(1)
    expect(spells[0].attackerId).toBe('GUARD_NONE')
    expect(spells[0].durationS).toBe(1.0)
  })

  it('reports the weakest confidence in the spell', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0, 3), cell(1, 6, 399.5, 1), cell(1, 6, 399.0, 2),
    ]))
    expect(spells[0].minConfidence).toBe(1)
  })

  it('tracks defenders independently', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0), cell(1, 6, 399.5),
      cell(2, 7, 400.0), cell(2, 7, 399.5),
    ]))
    expect(spells).toHaveLength(2)
    expect(spells.map(s => s.defenderId).sort()).toEqual([1, 2])
  })

  it('ignores annotations whose bucket has no tracking data', () => {
    const spells = computeMarkingSpells(base([cell(1, 6, 999)]))
    expect(spells).toHaveLength(0)
  })

  it('carries frame extents so a spell can be replayed', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0), cell(1, 6, 399.5),
    ]))
    expect(spells[0].startFrame).toBe(0)
    expect(spells[0].endFrame).toBe(12)
  })

  it('handles a single isolated bucket', () => {
    const spells = computeMarkingSpells(base([cell(1, 6, 399.0)]))
    expect(spells).toHaveLength(1)
    expect(spells[0]).toMatchObject({ bucketCount: 1, durationS: 0.5, endedBy: 'end' })
  })

  it('returns nothing for no annotations', () => {
    expect(computeMarkingSpells(base([]))).toEqual([])
  })
})

describe('summariseSpells', () => {
  it('totals duration and counts genuine switches', () => {
    const spells = computeMarkingSpells(base([
      cell(1, 6, 400.0), cell(1, 6, 399.5),   // 1.0s, ends in a switch
      cell(1, 7, 399.0),                       // 0.5s, ends at the end
    ]))
    expect(summariseSpells(spells)).toMatchObject({
      count: 2, totalSeconds: 1.5, switches: 1,
    })
  })
})
