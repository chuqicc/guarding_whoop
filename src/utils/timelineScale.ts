import { QUARTER_BUCKET_S } from '../constants'

/**
 * The horizontal scale shared by every timeline lane on the compare page.
 *
 * The dead-ball lanes, the time axis, the cumulative chart and the defender
 * grid only mean anything together if a given bucket sits at the same x in all
 * of them. Keeping the mapping in one place is what guarantees that; a second
 * copy that drifted would make the comparison quietly misleading rather than
 * obviously broken.
 */

export const LABEL_W = 170
export const PX_PER_S = 26
export const ROW_H = 30
export const LANE_H = 22

/** `mm:ss.s` — bucket values are seconds remaining on the quarter clock. */
export function fmtClock(bucket: number): string {
  const m = Math.floor(bucket / 60)
  const s = bucket % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/** `mm:ss` — for axis ticks, where the tenth is noise. */
export function fmtClockShort(bucket: number): string {
  const m = Math.floor(bucket / 60)
  const s = Math.round(bucket % 60)
  // Rounding 59.7 up to 60 would print "6:60".
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}

export interface TimelineScale {
  /** Left edge, in px, of a bucket's column. */
  xOf: (bucket: number) => number
  /** Width, in px, of a span covering `seconds` of clock. */
  widthOf: (seconds: number) => number
  /** Total lane width, in px. */
  totalW: number
}

/**
 * `orderedBuckets` must be descending — the quarter clock counts down.
 *
 * Both position and total width come from the clock SPAN, never the array
 * length. Deriving the width from the bucket count instead used to leave bars
 * painted beyond the declared width whenever the tracking data had a hole: the
 * scroll range is computed from that width, so the rightmost bars could not be
 * reached, and any axis drawn on a count basis would drift from the bars by the
 * accumulated gap.
 */
export function makeScale(orderedBuckets: number[]): TimelineScale {
  const firstBucket = orderedBuckets[0] ?? 0
  const lastBucket = orderedBuckets[orderedBuckets.length - 1] ?? firstBucket
  const spanS = firstBucket - lastBucket + QUARTER_BUCKET_S

  return {
    xOf: (bucket: number) => (firstBucket - bucket) * PX_PER_S,
    widthOf: (seconds: number) => seconds * PX_PER_S,
    totalW: orderedBuckets.length === 0 ? 240 : Math.max(240, spanS * PX_PER_S),
  }
}

export interface TimeTick {
  bucket: number
  label: string
  /** Majors carry a label; minors are a bare hairline. */
  major: boolean
}

/** Tick intervals in seconds, coarsest last. */
const STEPS = [1, 2, 5, 10, 15, 30, 60]

/**
 * Clock ticks at a readable spacing, aligned to round seconds rather than to
 * whichever bucket happens to be first.
 */
export function ticks(orderedBuckets: number[], targetSpacingPx = 160): TimeTick[] {
  if (orderedBuckets.length === 0) return []

  const first = orderedBuckets[0]
  const last = orderedBuckets[orderedBuckets.length - 1]
  if (first === last) return [{ bucket: first, label: fmtClockShort(first), major: true }]

  // Pick the step whose pixel spacing lands closest to the target.
  const step = STEPS.reduce((best, s) =>
    Math.abs(s * PX_PER_S - targetSpacingPx) < Math.abs(best * PX_PER_S - targetSpacingPx) ? s : best,
  STEPS[0])
  const minorStep = step / 2

  const out: TimeTick[] = []
  // Clock counts down, so walk from the round value at or below `first`.
  const start = Math.floor(first / minorStep) * minorStep
  for (let t = start; t >= last - 1e-9; t -= minorStep) {
    const bucket = parseFloat(t.toFixed(6))
    if (bucket > first + 1e-9) continue
    const major = Math.abs(bucket / step - Math.round(bucket / step)) < 1e-9
    out.push({ bucket, label: major ? fmtClockShort(bucket) : '', major })
  }
  return out
}
