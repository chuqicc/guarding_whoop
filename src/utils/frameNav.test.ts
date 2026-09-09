import { describe, it, expect } from 'vitest'
import { stepBucket, bucketOfFrame } from './frameNav'
import type { TrackingFrame } from '../store/useStore'

const frame = (i: number, quarterClock: number): TrackingFrame => ({
  frameIndex: i, momentId: 1000 + i, quarterClock, shotClock: 24,
  ballX: 0, ballY: 0, ballZ: 0, players: [],
})

/** Evenly spaced frames, quarter clock counting down. */
const evenly = (startClock: number, count: number, stepS: number): TrackingFrame[] =>
  Array.from({ length: count }, (_, i) =>
    frame(i, parseFloat((startClock - i * stepS).toFixed(4))))

// 25fps, starting just inside a bucket so the first bucket is a full one.
const frames = evenly(400.48, 120, 0.04)

describe('bucketOfFrame', () => {
  it('floors the quarter clock onto the 0.5s grid', () => {
    expect(bucketOfFrame(frame(0, 400.48))).toBe(400.0)
    expect(bucketOfFrame(frame(0, 400.00))).toBe(400.0)
    expect(bucketOfFrame(frame(0, 399.96))).toBe(399.5)
  })
})

describe('one press moves exactly one grid column', () => {
  it('a bucket is 12–13 frames at 25fps, never the 25 the old binding used', () => {
    const a = stepBucket(frames, 0, 1)
    const b = stepBucket(frames, a, 1)
    expect(a).toBe(13)          // bucket 400.0 held 13 frames
    expect(b - a).toBe(12)      // bucket 399.5 held 12
  })

  it('lands on the first frame of the next bucket', () => {
    const next = stepBucket(frames, 0, 1)
    expect(bucketOfFrame(frames[0])).toBe(400.0)
    expect(bucketOfFrame(frames[next])).toBe(399.5)
    expect(bucketOfFrame(frames[next - 1])).toBe(400.0)   // really the boundary
  })

  it('advances one bucket even when starting mid-bucket', () => {
    expect(bucketOfFrame(frames[5])).toBe(400.0)          // still inside the first
    const next = stepBucket(frames, 5, 1)
    expect(bucketOfFrame(frames[next])).toBe(399.5)
  })

  it('steps back to the first frame of the previous bucket', () => {
    const start = stepBucket(frames, 0, 1)
    expect(stepBucket(frames, start, -1)).toBe(0)
  })

  it('forward then back returns to where it started', () => {
    const from = 13                                        // a bucket start
    expect(stepBucket(frames, stepBucket(frames, from, 1), -1)).toBe(from)
  })

  it('clamps at both ends of the quarter', () => {
    expect(stepBucket(frames, 0, -1)).toBe(0)
    expect(stepBucket(frames, 3, -1)).toBe(0)
    const last = frames.length - 1
    expect(stepBucket(frames, last, 1)).toBe(last)
  })
})

describe('uneven tracking data', () => {
  // Real SportVU moments are not perfectly spaced, which is why a fixed
  // frame count drifts off the grid but a clock-derived step does not.
  const uneven = [400.40, 400.20, 400.05, 399.90, 399.60, 399.30, 399.05]
    .map((qc, i) => frame(i, qc))

  it('moves one bucket regardless of how many frames that bucket holds', () => {
    const a = stepBucket(uneven, 0, 1)
    expect(a).toBe(3)
    expect(bucketOfFrame(uneven[a])).toBe(399.5)

    const b = stepBucket(uneven, a, 1)
    expect(b).toBe(5)
    expect(bucketOfFrame(uneven[b])).toBe(399.0)
  })

  it('skips over a bucket that has no frames at all', () => {
    const gapped = [400.40, 400.20, 399.30, 399.05].map((qc, i) => frame(i, qc))
    const next = stepBucket(gapped, 0, 1)
    expect(bucketOfFrame(gapped[next])).toBe(399.0)       // 399.5 is missing
  })

  it('handles an empty quarter without throwing', () => {
    expect(stepBucket([], 0, 1)).toBe(0)
    expect(stepBucket([], 0, -1)).toBe(0)
  })

  it('tolerates an out-of-range playhead', () => {
    expect(stepBucket(frames, 99999, 1)).toBe(frames.length - 1)
    expect(stepBucket(frames, -5, -1)).toBe(0)
  })
})
