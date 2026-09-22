import type { TrackingFrame } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

/**
 * Buckets where the game clock stalled — i.e. the ball was dead.
 *
 * SportVU events overlap heavily: about 63% of the raw moments in a quarter are
 * exact duplicates, which the parser already drops by timestamp. What survives
 * that is a subtler overlap — the same stretch of game clock recorded at two
 * wall-clock times, minutes apart, because play stopped in between. The frames
 * then land in the same 0.5s bucket despite being different game situations.
 *
 * The tell is unambiguous: a 0.5s bucket should span about 0.5s of real time.
 * Measured across two games the distribution is sharply bimodal — p98 is 0.52s,
 * p99 jumps to 17.8s, and the worst bucket spans 183s. Nothing sits between, so
 * the threshold is not a judgement call: anything in the upper mode had the
 * clock stopped, which is the definition of a dead ball.
 */

/** 4x the nominal bucket duration, comfortably inside the empty zone. */
export const STALL_THRESHOLD_S = 2

export interface StalledBucket {
  bucket: number
  /** Real seconds the bucket's frames span. */
  spanS: number
  frameCount: number
}

/**
 * Buckets whose frames span more real time than the game clock can account for.
 *
 * Frames without a `momentId` are ignored rather than treated as zero — an
 * absent timestamp says nothing about elapsed time.
 */
export function findStalledBuckets(
  frames: TrackingFrame[],
  thresholdS: number = STALL_THRESHOLD_S,
): StalledBucket[] {
  const byBucket = new Map<number, { min: number; max: number; n: number }>()

  for (const f of frames) {
    if (f.momentId === undefined) continue
    const bucket = Math.floor(f.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
    const cur = byBucket.get(bucket)
    if (!cur) byBucket.set(bucket, { min: f.momentId, max: f.momentId, n: 1 })
    else {
      if (f.momentId < cur.min) cur.min = f.momentId
      if (f.momentId > cur.max) cur.max = f.momentId
      cur.n++
    }
  }

  const out: StalledBucket[] = []
  for (const [bucket, { min, max, n }] of byBucket) {
    const spanS = (max - min) / 1000
    if (spanS > thresholdS) {
      out.push({ bucket, spanS: parseFloat(spanS.toFixed(3)), frameCount: n })
    }
  }

  // Clock counts down, so descending bucket order is chronological.
  return out.sort((a, b) => b.bucket - a.bucket)
}
