import { describe, it, expect } from 'vitest'
import { computeCarryForward, type CarryForwardInput } from './carryForward'
import type { CellAnnotation, Player } from '../store/useStore'

const TEAM_A = 100
const TEAM_B = 200

const playerDict: Record<number, Player> = {
  1: { id: 1, name: 'Def One', jersey: '4',  teamId: TEAM_A, teamAbbr: 'AAA' },
  2: { id: 2, name: 'Def Two', jersey: '5',  teamId: TEAM_A, teamAbbr: 'AAA' },
  6: { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
  7: { id: 7, name: 'Att Two', jersey: '11', teamId: TEAM_B, teamAbbr: 'BBB' },
}

function ann(defenderId: number, attackerId: number | 'GUARD_NONE', bucket: number, confidence?: 1 | 2 | 3): CellAnnotation {
  return { id: `${defenderId}_${bucket}`, defenderId, attackerId, shotClockBucket: bucket, confidence }
}

// Buckets count down over time; frame indices count up.
// bucket 20 → frames 0-24, bucket 19 → 25-49, bucket 18 → 50-74 …
const bucketFrameStart = new Map<number, number>([
  [20, 0], [19, 25], [18, 50], [17, 75],
])

function base(over: Partial<CarryForwardInput> = {}): CarryForwardInput {
  return {
    currentBucket: 19,
    cellAnnotations: [ann(1, 6, 20, 2)],
    playerDict,
    defendingTeamId: TEAM_A,
    autoFillMemory: true,
    deadTimeBuckets: [],
    memoryBarrierFrames: [],
    bucketFrameStart,
    ...over,
  }
}

describe('computeCarryForward', () => {
  it('carries the previous bucket assignment forward (memory ON)', () => {
    const fills = computeCarryForward(base())
    expect(fills).toEqual([{ defenderId: 1, attackerId: 6, confidence: 2 }])
  })

  it('feature 3: fills nothing when auto-fill memory is OFF', () => {
    expect(computeCarryForward(base({ autoFillMemory: false }))).toEqual([])
  })

  it('feature 1: never fills into a dead-time bucket, even when previous data exists', () => {
    expect(computeCarryForward(base({ deadTimeBuckets: [19] }))).toEqual([])
  })

  it('feature 2: never carries across a defending-team swap barrier', () => {
    // swap happened at frame 25 (start of bucket 19) → memory from bucket 20 is wiped
    expect(computeCarryForward(base({ memoryBarrierFrames: [25] }))).toEqual([])
  })

  it('feature 2: a barrier in the future does not block filling', () => {
    // swap recorded later (frame 60) — carrying 20 → 19 is still fine
    const fills = computeCarryForward(base({ memoryBarrierFrames: [60] }))
    expect(fills).toHaveLength(1)
  })

  it('feature 2: barrier blocks even when the source bucket is several buckets back', () => {
    const fills = computeCarryForward(base({
      currentBucket: 17,
      memoryBarrierFrames: [25],   // swap at start of bucket 19; source is bucket 20
    }))
    expect(fills).toEqual([])
  })

  it('does not overwrite an existing annotation in the current bucket', () => {
    const fills = computeCarryForward(base({
      cellAnnotations: [ann(1, 6, 20), ann(1, 7, 19)],
    }))
    expect(fills).toEqual([])
  })

  it('does not carry from a bucket where the other team was defending', () => {
    // bucket 20 was annotated by a TEAM_B defender → belongs to the other side
    const fills = computeCarryForward(base({
      cellAnnotations: [ann(6, 1, 20)],
    }))
    expect(fills).toEqual([])
  })

  it('carries GUARD_NONE forward like any other assignment', () => {
    const fills = computeCarryForward(base({ cellAnnotations: [ann(2, 'GUARD_NONE', 20)] }))
    expect(fills).toEqual([{ defenderId: 2, attackerId: 'GUARD_NONE', confidence: undefined }])
  })
})
