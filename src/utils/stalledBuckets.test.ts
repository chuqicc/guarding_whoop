import { describe, it, expect } from 'vitest'
import { findStalledBuckets, STALL_THRESHOLD_S } from './stalledBuckets'
import type { TrackingFrame } from '../store/useStore'

const T0 = 1446086883870   // a real moment from 0021500017 Q1

/** Frames at 25fps walking the clock down from `clock`. */
function run(startMoment: number, clock: number, n: number): TrackingFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    frameIndex: i,
    momentId: startMoment + i * 40,
    quarterClock: parseFloat((clock - i * 0.04).toFixed(3)),
    shotClock: 24,
    ballX: 0, ballY: 0, ballZ: 0, players: [],
  }))
}

describe('findStalledBuckets', () => {
  it('leaves ordinary play alone', () => {
    // A 0.5s bucket taking 0.5s of real time is exactly normal.
    expect(findStalledBuckets(run(T0, 429, 60))).toEqual([])
  })

  it('flags a bucket whose frames straddle a stoppage', () => {
    // The real case: bucket 7:08.5 in 0021500017 Q1 spans 182.6s because a
    // timeout happened mid-bucket.
    const before = run(T0, 428.9, 3)
    const after = run(T0 + 182_600, 428.86, 3)
    const found = findStalledBuckets([...before, ...after])

    expect(found).toHaveLength(1)
    expect(found[0].bucket).toBe(428.5)
    expect(found[0].spanS).toBeCloseTo(182.68, 1)
    expect(found[0].frameCount).toBe(6)
  })

  it('reports the bucket, its real span and how many frames it holds', () => {
    const found = findStalledBuckets([...run(T0, 428.9, 3), ...run(T0 + 30_000, 428.86, 3)])
    expect(found[0]).toMatchObject({ bucket: 428.5, frameCount: 6 })
    expect(found[0].spanS).toBeGreaterThan(29)
  })

  it('returns buckets in clock order, which counts down', () => {
    const a = [...run(T0, 428.9, 3), ...run(T0 + 30_000, 428.86, 3)]
    const b = [...run(T0 + 60_000, 419.9, 3), ...run(T0 + 90_000, 419.86, 3)]
    const found = findStalledBuckets([...a, ...b])
    expect(found.map(f => f.bucket)).toEqual([428.5, 419.5])
  })

  it('honours a caller-supplied threshold', () => {
    const frames = [...run(T0, 428.9, 3), ...run(T0 + 3_000, 428.86, 3)]
    expect(findStalledBuckets(frames, 5)).toEqual([])      // 3s gap, 5s threshold
    expect(findStalledBuckets(frames, 2)).toHaveLength(1)
  })

  it('uses a threshold well clear of normal play', () => {
    // Measured p98 is 0.52s and p99 is 17.8s — nothing lies between, so the
    // exact value does not matter as long as it sits in that empty zone.
    expect(STALL_THRESHOLD_S).toBeGreaterThan(1)
    expect(STALL_THRESHOLD_S).toBeLessThan(5)
  })

  it('ignores frames with no timestamp rather than treating them as zero', () => {
    const frames: TrackingFrame[] = [
      { ...run(T0, 429, 1)[0], momentId: undefined },
      ...run(T0, 429, 4),
    ]
    expect(findStalledBuckets(frames)).toEqual([])
  })

  it('handles an empty quarter', () => {
    expect(findStalledBuckets([])).toEqual([])
  })

  it('does not flag a long bucket that is merely dense', () => {
    // Many frames, but all within half a second of real time.
    const dense = Array.from({ length: 200 }, (_, i) => ({
      frameIndex: i, momentId: T0 + i * 2, quarterClock: 429 - i * 0.002,
      shotClock: 24, ballX: 0, ballY: 0, ballZ: 0, players: [],
    }))
    expect(findStalledBuckets(dense)).toEqual([])
  })
})
