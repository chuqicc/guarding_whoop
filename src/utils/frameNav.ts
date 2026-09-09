import type { TrackingFrame } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

/**
 * Playhead navigation in units of annotation buckets.
 *
 * Stepping by a fixed frame count drifts: a 0.5s bucket is nominally 12.5
 * frames at 25fps, and real tracking data has uneven moment spacing and gaps,
 * so no constant lands on a cell boundary for long. Deriving the step from the
 * quarter clock means one press always moves exactly one grid column.
 */

export function bucketOfFrame(frame: TrackingFrame): number {
  return Math.floor(frame.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
}

/** Index of the first frame belonging to the same bucket as `from`. */
function startOfBucket(frames: TrackingFrame[], from: number): number {
  const bucket = bucketOfFrame(frames[from])
  let i = from
  while (i > 0 && bucketOfFrame(frames[i - 1]) === bucket) i--
  return i
}

/**
 * Move one annotation bucket forward (`dir: 1`) or back (`dir: -1`), landing on
 * the first frame of the target bucket. Clamps at either end of the quarter.
 */
export function stepBucket(frames: TrackingFrame[], currentFrame: number, dir: 1 | -1): number {
  if (frames.length === 0) return 0
  const cur = Math.min(Math.max(currentFrame, 0), frames.length - 1)
  const bucket = bucketOfFrame(frames[cur])

  if (dir === 1) {
    for (let i = cur + 1; i < frames.length; i++) {
      if (bucketOfFrame(frames[i]) !== bucket) return i
    }
    return frames.length - 1        // already in the last bucket
  }

  const start = startOfBucket(frames, cur)
  if (start === 0) return 0         // already in the first bucket
  return startOfBucket(frames, start - 1)
}
