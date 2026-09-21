import type { AnnotationDocument } from './annotationDocument'
import { QUARTER_BUCKET_S } from '../constants'

/**
 * Dead-ball comparison between two annotators.
 *
 * Read straight from `DocumentBucket.status` rather than from the agreement
 * cells, for three reasons:
 *
 *  - The cell path collapses "both marked dead" and "only one did" into a
 *    single `dead-excluded` status, so the direction of the disagreement is
 *    unrecoverable there.
 *  - Cells only exist for buckets someone annotated, so a dead bucket with no
 *    assignments produces nothing at all and leaves a hole.
 *  - Runs in the grid break whenever the carried-forward attacker changes,
 *    which fragments one stoppage into several bars for no reason — the
 *    attacker is irrelevant to whether the clock was stopped.
 *
 * Dead-ball marks matter more than their share of the UI suggests: downstream
 * they define possession boundaries, and possessions are the unit the
 * bootstrap resamples, so a disagreement here moves the confidence intervals.
 */

export type Side = 'a' | 'b'

export interface DeadSpan {
  side: Side
  /** The clock counts down, so startBucket >= endBucket. */
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  frameStart?: number
  /** How many buckets in this span the other annotator also called dead. */
  agreedBuckets: number
}

/**
 * A contiguous stretch where the two annotators disagree about the game state.
 *
 * This, not the individual spans, is the unit a reviewer steps through: a
 * 1.5-second boundary offset is one thing to look at, not three.
 */
export interface DeadDisagreement {
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  /** The side that called it dead; the other called it live. */
  deadSide: Side
  frameStart?: number
}

/** One bucket's state for both annotators, plus the running totals. */
export interface DeadSeriesPoint {
  bucket: number
  aDead: boolean
  bDead: boolean
  /** Seconds of dead ball each annotator has marked up to and including this bucket. */
  cumA: number
  cumB: number
}

export interface DeadComparison {
  /** Buckets present in BOTH documents, descending. Only these are comparable. */
  orderedBuckets: number[]
  spans: DeadSpan[]
  /** The per-bucket confusion matrix, including the off-diagonal. */
  confusion: { bothDead: number; aOnly: number; bOnly: number; bothActive: number }
  /** Dead buckets marked by each side. A zero means that file marked none at all. */
  usage: { a: number; b: number }
  /** Stretches where exactly one annotator called it dead. */
  disagreements: DeadDisagreement[]
  /**
   * Per-bucket state and running totals, same order and length as
   * `orderedBuckets`. The cumulative pair is what shows systematic bias: two
   * lines that keep spreading mean one annotator consistently calls more dead
   * time, which a per-bucket agreement rate cannot distinguish from noise.
   */
  series: DeadSeriesPoint[]
}

const isDead = (doc: AnnotationDocument, bucket: number) =>
  doc.buckets.get(bucket)?.status === 'dead'

/** Merge a side's consecutive dead buckets into spans. */
function spansFor(
  doc: AnnotationDocument,
  other: AnnotationDocument,
  side: Side,
  orderedBuckets: number[],
): DeadSpan[] {
  const out: DeadSpan[] = []
  let run: number[] = []

  const flush = () => {
    if (run.length === 0) return
    const startBucket = run[0]
    const endBucket = run[run.length - 1]
    out.push({
      side,
      startBucket,
      endBucket,
      bucketCount: run.length,
      durationS: parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
      frameStart: doc.buckets.get(startBucket)?.frameStart
        ?? other.buckets.get(startBucket)?.frameStart,
      agreedBuckets: run.filter(b => isDead(other, b)).length,
    })
    run = []
  }

  for (let i = 0; i < orderedBuckets.length; i++) {
    const bucket = orderedBuckets[i]
    if (!isDead(doc, bucket)) { flush(); continue }
    // A span only continues across buckets that are adjacent in the data; a
    // hole in the tracking is a break, not a continuation.
    const prev = run[run.length - 1]
    if (prev !== undefined && orderedBuckets[i - 1] !== prev) flush()
    run.push(bucket)
  }
  flush()

  return out
}

/** Run-length encode the buckets where exactly one side called dead. */
function disagreementsIn(
  docA: AnnotationDocument,
  docB: AnnotationDocument,
  orderedBuckets: number[],
): DeadDisagreement[] {
  const out: DeadDisagreement[] = []
  let run: number[] = []
  let side: Side | null = null

  const flush = () => {
    if (run.length === 0 || side === null) { run = []; side = null; return }
    const startBucket = run[0]
    out.push({
      startBucket,
      endBucket: run[run.length - 1],
      bucketCount: run.length,
      durationS: parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
      deadSide: side,
      frameStart: docA.buckets.get(startBucket)?.frameStart
        ?? docB.buckets.get(startBucket)?.frameStart,
    })
    run = []
    side = null
  }

  for (let i = 0; i < orderedBuckets.length; i++) {
    const bucket = orderedBuckets[i]
    const a = isDead(docA, bucket)
    const b = isDead(docB, bucket)
    if (a === b) { flush(); continue }

    const thisSide: Side = a ? 'a' : 'b'
    // A run breaks when the disagreement flips direction, or when the buckets
    // are not adjacent in the data.
    const adjacent = run.length === 0 || orderedBuckets[i - 1] === run[run.length - 1]
    if (side !== null && (side !== thisSide || !adjacent)) flush()

    side = thisSide
    run.push(bucket)
  }
  flush()

  return out
}

export function compareDeadSpans(
  docA: AnnotationDocument,
  docB: AnnotationDocument,
): DeadComparison {
  // Only buckets both files cover can be compared; one-sided buckets say
  // nothing about agreement.
  const orderedBuckets = [...docA.buckets.keys()]
    .filter(b => docB.buckets.has(b))
    .sort((x, y) => y - x)

  // One pass produces both the confusion counts and the cumulative series;
  // the per-bucket classification used to be computed here and thrown away.
  const confusion = { bothDead: 0, aOnly: 0, bOnly: 0, bothActive: 0 }
  const series: DeadSeriesPoint[] = []
  let cumA = 0
  let cumB = 0

  for (const bucket of orderedBuckets) {
    const a = isDead(docA, bucket)
    const b = isDead(docB, bucket)
    if (a && b) confusion.bothDead++
    else if (a) confusion.aOnly++
    else if (b) confusion.bOnly++
    else confusion.bothActive++

    if (a) cumA += QUARTER_BUCKET_S
    if (b) cumB += QUARTER_BUCKET_S
    series.push({
      bucket,
      aDead: a,
      bDead: b,
      cumA: parseFloat(cumA.toFixed(3)),
      cumB: parseFloat(cumB.toFixed(3)),
    })
  }

  return {
    orderedBuckets,
    disagreements: disagreementsIn(docA, docB, orderedBuckets),
    spans: [
      ...spansFor(docA, docB, 'a', orderedBuckets),
      ...spansFor(docB, docA, 'b', orderedBuckets),
    ],
    confusion,
    series,
    usage: {
      a: confusion.bothDead + confusion.aOnly,
      b: confusion.bothDead + confusion.bOnly,
    },
  }
}
