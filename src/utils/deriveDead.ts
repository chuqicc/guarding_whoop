import type { TrackingFrame } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { STALL_THRESHOLD_S } from './stalledBuckets'

/**
 * Dead-ball buckets derived from the tracking data.
 *
 * This seeds the annotation; it is not the last word. The annotator reviews
 * every stoppage against the video anyway, so the job here is to remove the
 * "scan 1,430 buckets looking for stoppages" step, not to decide anything.
 *
 * ── Why the shot clock, and why EXACTLY 24 ─────────────────────────────────
 *
 * The obvious signal — "the game clock stopped" — does not work. Measured
 * against a hand-annotated quarter, the game clock advances 0.46s per dead
 * bucket and 0.45s per live one: indistinguishable, because the NBA clock keeps
 * running after a made basket.
 *
 * The shot clock separates them cleanly, but only at full precision:
 *
 *   made basket -> inbound   10.48 -> 24.00 -> 24.00 -> 24.00 ...   DEAD
 *   miss -> defensive board   3.95 -> 23.98 -> 23.88 -> 23.78 ...   LIVE
 *
 * Both "reset to 24". The difference is that after a made basket the clock is
 * held until the ball is legally touched inbounds, while after a rebound it
 * starts immediately. A >= 23.95 threshold merges the two and collapses the
 * median dead span from 4.3s to 0.5s. Hence the exact comparison.
 *
 * That the clock starts when the ball is touched inbounds is also precisely the
 * end of the dead period we want, so rule A needs no separate end condition.
 *
 * ── What the long locks are ────────────────────────────────────────────────
 *
 * Some locks run 60-90 seconds. They are not corrupt data: across those spans
 * the game clock advances 0.0-1.1s while players drift at walking pace — free
 * throws, timeouts, reviews. Since buckets are keyed by the game clock, a
 * 90-second stoppage collapses into roughly ONE bucket, which is why rule B
 * exists at all: when SportVU stops recording entirely, the only trace left is
 * a gap between consecutive timestamps inside a single bucket.
 */

/** Hoop centres, feet. Court is 94 x 50 (`constants.ts`). */
const HOOP_X = [5.25, 88.75] as const
const HOOP_Y = 25
/** Ball counts as through the hoop inside this radius, at rim height. */
const HOOP_RADIUS_FT = 1.2
const RIM_Z_MIN = 9.0
const RIM_Z_MAX = 10.5

/** A lock shorter than this is timestamp noise, not a held clock. */
const MIN_LOCK_FRAMES = 3
/** How far after a made basket the shot-clock reset may appear. */
const MADE_BASKET_LOOKAHEAD_S = 1.5

export type DeadReason =
  /** Shot clock reset and held — inbound after a made basket, free throws, timeout. */
  | 'shot-clock-locked'
  /** Tracking stopped recording: a whistle the data skips over. */
  | 'tracking-gap'
  /** The bucket the ball dropped through the hoop, ahead of the reset. */
  | 'made-basket'

export interface DerivedDead {
  /** Descending — the quarter clock counts down. */
  buckets: number[]
  reason: Map<number, DeadReason>
  /**
   * Buckets with no shot clock at all, where rule A cannot apply. Mostly the
   * last 24 seconds of a quarter, when the shot clock is switched off. Worth
   * surfacing: these are the only places the annotator is fully on their own.
   */
  noShotClock: number[]
}

const bucketOf = (f: TrackingFrame) =>
  Math.floor(f.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S

/** Exact 24.00 — see the header for why this is not a tolerance. */
const isLocked = (f: TrackingFrame) => f.shotClock === 24

function throughHoop(f: TrackingFrame): boolean {
  if (f.ballZ < RIM_Z_MIN || f.ballZ > RIM_Z_MAX) return false
  return HOOP_X.some(hx => Math.hypot(f.ballX - hx, f.ballY - HOOP_Y) < HOOP_RADIUS_FT)
}

export function deriveDead(frames: TrackingFrame[]): DerivedDead {
  const reason = new Map<number, DeadReason>()
  if (frames.length === 0) return { buckets: [], reason, noShotClock: [] }

  // Bucket order, and the frames in each. Frames arrive in frameIndex order,
  // so each bucket's list is already chronological.
  const byBucket = new Map<number, TrackingFrame[]>()
  for (const f of frames) {
    const b = bucketOf(f)
    const cur = byBucket.get(b)
    if (cur) cur.push(f)
    else byBucket.set(b, [f])
  }
  const ordered = [...byBucket.keys()].sort((a, b) => b - a)
  const indexOf = new Map(ordered.map((b, i) => [b, i]))

  // Claim a bucket. First reason wins, so the precedence below is the order of
  // the passes: a whistle stoppage that also shows a held clock reads as the
  // stoppage, which is the stronger fact about it.
  const claim = (bucket: number, why: DeadReason) => {
    if (!reason.has(bucket)) reason.set(bucket, why)
  }

  // ── B: tracking gap ──────────────────────────────────────────────────────
  // Frames without a momentId say nothing about elapsed time, so they are
  // skipped rather than counted as zero.
  for (const [bucket, fs] of byBucket) {
    let min = Infinity
    let max = -Infinity
    for (const f of fs) {
      if (f.momentId === undefined) continue
      if (f.momentId < min) min = f.momentId
      if (f.momentId > max) max = f.momentId
    }
    if (min !== Infinity && (max - min) / 1000 > STALL_THRESHOLD_S) {
      claim(bucket, 'tracking-gap')
    }
  }

  // ── A: shot clock held at 24 ─────────────────────────────────────────────
  // Scanned over the whole frame array, not per bucket: a lock routinely runs
  // several seconds and therefore spans several buckets.
  let runStart = -1
  const flushRun = (end: number) => {
    if (runStart >= 0 && end - runStart >= MIN_LOCK_FRAMES) {
      for (let i = runStart; i < end; i++) claim(bucketOf(frames[i]), 'shot-clock-locked')
    }
    runStart = -1
  }
  for (let i = 0; i < frames.length; i++) {
    if (isLocked(frames[i])) { if (runStart < 0) runStart = i }
    else flushRun(i)
  }
  flushRun(frames.length)

  // ── C: back-date the start to the made basket ────────────────────────────
  // The scorer's table resets the shot clock about half a second after the ball
  // drops through, so rule A alone starts every made-basket stoppage one bucket
  // late. Only applied when a lock actually follows — a ball passing through
  // the rim on a live rebound must not drag a bucket in.
  const lookahead = Math.round(MADE_BASKET_LOOKAHEAD_S / QUARTER_BUCKET_S)
  for (const f of frames) {
    if (!throughHoop(f)) continue
    const from = indexOf.get(bucketOf(f))
    if (from === undefined) continue
    for (let j = from; j <= Math.min(from + lookahead, ordered.length - 1); j++) {
      if (reason.get(ordered[j]) !== 'shot-clock-locked') continue
      // Fill the whole span, so the stoppage reads as one run rather than two.
      for (let k = from; k <= j; k++) claim(ordered[k], 'made-basket')
      break
    }
  }

  const noShotClock = ordered.filter(b =>
    byBucket.get(b)!.every(f => f.shotClock === null || f.shotClock === undefined))

  return {
    buckets: ordered.filter(b => reason.has(b)),
    reason,
    noShotClock,
  }
}
