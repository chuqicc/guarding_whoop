import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import type { PossessionMeta, Player } from './useStore'

const TEAM_A = 100
const TEAM_B = 200

const playersA: Player[] = [{ id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' }]
const playersB: Player[] = [{ id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' }]

const meta: PossessionMeta = {
  filename: 'store_test', gameId: 'G1', quarter: 1, possessionIndex: 1,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A,
  totalFrames: 100, startClock: 400, endClock: 380,
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    possession: { ...meta }, quarterMeta: null, mode: 'possession',
    cellAnnotations: [], deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
    memoryBarrierFrames: [], currentFrame: 0, autoFillMemory: true,
  })
})

describe('feature 1 — dead-time hard block', () => {
  it('setCellAnnotation is rejected on a dead bucket', () => {
    useStore.setState({ deadTimeBuckets: [10] })
    useStore.getState().setCellAnnotation(1, 6, 10)
    expect(useStore.getState().cellAnnotations).toHaveLength(0)
  })

  it('setCellAnnotation still works on a live bucket', () => {
    useStore.setState({ deadTimeBuckets: [10] })
    useStore.getState().setCellAnnotation(1, 6, 9)
    expect(useStore.getState().cellAnnotations).toHaveLength(1)
  })
})

describe('feature 2 — swap records a memory barrier', () => {
  it('toggleDefendingTeam flips defense and stores the current frame as barrier', () => {
    useStore.setState({ currentFrame: 42 })
    useStore.getState().toggleDefendingTeam()
    const s = useStore.getState()
    expect(s.possession?.defendingTeamId).toBe(TEAM_B)
    expect(s.memoryBarrierFrames).toEqual([42])
    expect(localStorage.getItem('membarrier_store_test')).toBe('[42]')
  })

  it('swapping twice at the same frame stores the barrier once', () => {
    useStore.setState({ currentFrame: 42 })
    useStore.getState().toggleDefendingTeam()
    useStore.getState().toggleDefendingTeam()
    expect(useStore.getState().memoryBarrierFrames).toEqual([42])
  })
})

describe('feature 3 — auto-fill memory toggle', () => {
  it('toggles and persists globally', () => {
    expect(useStore.getState().autoFillMemory).toBe(true)
    useStore.getState().toggleAutoFillMemory()
    expect(useStore.getState().autoFillMemory).toBe(false)
    expect(localStorage.getItem('autoFillMemory')).toBe('off')
    useStore.getState().toggleAutoFillMemory()
    expect(localStorage.getItem('autoFillMemory')).toBe('on')
  })
})

describe('feature 4 — shot / rebound bucket marks', () => {
  it('toggleShotBucket marks, persists and unmarks', () => {
    useStore.getState().toggleShotBucket(15)
    expect(useStore.getState().shotBuckets).toEqual([15])
    expect(localStorage.getItem('shot_store_test')).toBe('[15]')
    useStore.getState().toggleShotBucket(15)
    expect(useStore.getState().shotBuckets).toEqual([])
  })

  it('toggleReboundBucket works independently', () => {
    useStore.getState().toggleReboundBucket(15)
    useStore.getState().toggleShotBucket(14)
    expect(useStore.getState().reboundBuckets).toEqual([15])
    expect(useStore.getState().shotBuckets).toEqual([14])
  })
})

describe('restoreImported', () => {
  it('replaces annotations and event buckets, persists all', () => {
    useStore.getState().restoreImported({
      annotations: [{ id: 'x', defenderId: 1, attackerId: 6, shotClockBucket: 20 }],
      deadTimeBuckets: [19],
      shotBuckets: [20],
      reboundBuckets: [18],
    })
    const s = useStore.getState()
    expect(s.cellAnnotations).toHaveLength(1)
    expect(s.deadTimeBuckets).toEqual([19])
    expect(s.shotBuckets).toEqual([20])
    expect(s.reboundBuckets).toEqual([18])
    expect(localStorage.getItem('deadtime_store_test')).toBe('[19]')
  })

  it('keeps existing bucket marks when the import has none (legacy formats)', () => {
    useStore.setState({ deadTimeBuckets: [5], shotBuckets: [6] })
    useStore.getState().restoreImported({ annotations: [] })
    const s = useStore.getState()
    expect(s.deadTimeBuckets).toEqual([5])
    expect(s.shotBuckets).toEqual([6])
  })
})
