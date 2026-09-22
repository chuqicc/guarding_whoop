import { describe, it, expect } from 'vitest'
import { deriveDead } from './deriveDead'
import type { TrackingFrame } from '../store/useStore'

interface BucketSpec {
  bucket: number
  shotClock: number | null
  /** Frames in this bucket; the real data holds 12-13. */
  n?: number
  ball?: [number, number, number]
  /** Real time skipped before this bucket's first frame — a tracking stoppage. */
  gapMsBefore?: number
}

/**
 * Frames laid out one bucket at a time.
 *
 * Built bucket-first rather than by decrementing a clock: a running clock drifts
 * across bucket boundaries after a dozen frames, which silently moves the
 * fixture off the bucket the test names.
 */
function build(specs: BucketSpec[]): TrackingFrame[] {
  const out: TrackingFrame[] = []
  let t = 1_000_000
  for (const s of specs) {
    const n = s.n ?? 12
    if (s.gapMsBefore) t += s.gapMsBefore
    for (let i = 0; i < n; i++) {
      const [bx, by, bz] = s.ball ?? [47, 25, 4]
      out.push({
        frameIndex: out.length,
        momentId: t,
        // Stays strictly inside [bucket, bucket + 0.5).
        quarterClock: parseFloat((s.bucket + 0.4 - i * 0.03).toFixed(4)),
        shotClock: s.shotClock,
        ballX: bx, ballY: by, ballZ: bz,
        players: [{ id: 1, teamId: 100, x: 0, y: 0 }],
      })
      t += 40
    }
  }
  return out
}

describe('rule A — shot clock held at exactly 24', () => {
  it('marks a held clock dead', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10 },
      { bucket: 399.5, shotClock: 24 },
    ]))
    expect(d.buckets).toEqual([399.5])
    expect(d.reason.get(399.5)).toBe('shot-clock-locked')
  })

  it('leaves a reset that starts running alone — a defensive rebound is live', () => {
    // The distinction the whole rule rests on: 23.98 counting down is play,
    // 24.00 held is not. A tolerance of >= 23.95 merges the two.
    expect(deriveDead(build([
      { bucket: 400, shotClock: 4 },
      { bucket: 399.5, shotClock: 23.98 },
      { bucket: 399, shotClock: 23.88 },
      { bucket: 398.5, shotClock: 23.78 },
    ])).buckets).toHaveLength(0)
  })

  it('ignores a lock shorter than three frames', () => {
    expect(deriveDead(build([
      { bucket: 400, shotClock: 10 },
      { bucket: 399.5, shotClock: 24, n: 2 },
      { bucket: 399, shotClock: 23.9 },
    ])).buckets).toHaveLength(0)
  })

  it('spans every bucket a long lock touches', () => {
    expect(deriveDead(build([
      { bucket: 400, shotClock: 10 },
      { bucket: 399.5, shotClock: 24 },
      { bucket: 399, shotClock: 24 },
      { bucket: 398.5, shotClock: 24 },
      { bucket: 398, shotClock: 23.5 },
    ])).buckets).toEqual([399.5, 399, 398.5])
  })
})

describe('rule B — tracking gap', () => {
  it('marks a bucket whose frames span more than two seconds', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10, n: 6 },
      { bucket: 400, shotClock: 10, n: 6, gapMsBefore: 2_500 },
    ]))
    expect(d.buckets).toEqual([400])
    expect(d.reason.get(400)).toBe('tracking-gap')
  })

  it('leaves a normally-paced bucket alone', () => {
    expect(deriveDead(build([
      { bucket: 400, shotClock: 10, n: 6 },
      { bucket: 400, shotClock: 10, n: 6, gapMsBefore: 500 },
    ])).buckets).toHaveLength(0)
  })

  it('takes precedence over a held clock — the stoppage is the stronger fact', () => {
    expect(deriveDead(build([
      { bucket: 400, shotClock: 24, n: 6 },
      { bucket: 400, shotClock: 24, n: 6, gapMsBefore: 3_000 },
    ])).reason.get(400)).toBe('tracking-gap')
  })
})

describe('rule C — back-dating to the made basket', () => {
  const THROUGH: [number, number, number] = [5.25, 25, 9.8]

  it('pulls in the bucket the ball dropped through the hoop', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10, ball: THROUGH },  // the make
      { bucket: 399.5, shotClock: 10.5 },             // scorer's table lag
      { bucket: 399, shotClock: 24 },                 // the inbound
      { bucket: 398.5, shotClock: 24 },
    ]))
    expect(d.reason.get(400)).toBe('made-basket')
    // The gap is filled, so the stoppage reads as one run rather than two.
    expect(d.reason.get(399.5)).toBe('made-basket')
    expect(d.reason.get(399)).toBe('shot-clock-locked')
    expect(d.buckets).toEqual([400, 399.5, 399, 398.5])
  })

  it('does not pull in a rim hit that no lock follows — a live rebound', () => {
    expect(deriveDead(build([
      { bucket: 400, shotClock: 10, ball: THROUGH },
      { bucket: 399.5, shotClock: 23.98 },
      { bucket: 399, shotClock: 23.5 },
    ])).buckets).toHaveLength(0)
  })

  it('ignores a ball passing high over the rim', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10, ball: [5.25, 25, 14] },
      { bucket: 399.5, shotClock: 24 },
    ]))
    expect(d.reason.get(400)).toBeUndefined()
    expect(d.buckets).toEqual([399.5])
  })

  it('works at the other hoop', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10, ball: [88.75, 25, 10] },
      { bucket: 399.5, shotClock: 24 },
    ]))
    expect(d.reason.get(400)).toBe('made-basket')
  })

  it('does not reach back further than 1.5 seconds', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: 10, ball: THROUGH },
      { bucket: 399.5, shotClock: 10 },
      { bucket: 399, shotClock: 10 },
      { bucket: 398.5, shotClock: 10 },
      { bucket: 398, shotClock: 10 },
      { bucket: 397.5, shotClock: 24 },
    ]))
    expect(d.reason.get(400)).toBeUndefined()
    expect(d.buckets).toEqual([397.5])
  })
})

describe('shape of the result', () => {
  it('reports buckets with no shot clock instead of judging them', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: null },
      { bucket: 399.5, shotClock: 10 },
    ]))
    expect(d.noShotClock).toEqual([400])
    expect(d.buckets).not.toContain(400)
  })

  it('still applies the tracking gap where there is no shot clock', () => {
    const d = deriveDead(build([
      { bucket: 400, shotClock: null, n: 6 },
      { bucket: 400, shotClock: null, n: 6, gapMsBefore: 3_000 },
    ]))
    expect(d.noShotClock).toEqual([400])
    expect(d.buckets).toEqual([400])
  })

  it('returns buckets descending, each listed once', () => {
    const b = deriveDead(build([
      { bucket: 400, shotClock: 24 },
      { bucket: 399.5, shotClock: 24 },
      { bucket: 399, shotClock: 24 },
    ])).buckets
    expect(b).toEqual([...b].sort((x, y) => y - x))
    expect(new Set(b).size).toBe(b.length)
  })

  it('handles an empty quarter', () => {
    expect(deriveDead([])).toEqual({ buckets: [], reason: new Map(), noShotClock: [] })
  })
})
