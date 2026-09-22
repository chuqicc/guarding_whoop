import type { AnnotationDocument } from './annotationDocument'
import { QUARTER_BUCKET_S } from '../constants'
import type { Side } from './deadSpans'

/**
 * Defending-team comparison between two annotators.
 *
 * This is the most damaging disagreement the tool can surface. Downstream the
 * defending team sets the direction every possession is mirrored into, so one
 * wrong stretch does not add noise to a cell — it flips a whole possession's
 * frame of reference. Yet until now the UI said only "N buckets differ" and
 * gave no way at all to find them.
 *
 * Read straight from `DocumentBucket.defTeam` rather than from the agreement
 * cells: the cell path drops the team labels entirely, keeping only a count.
 */

export interface DefenseSpan {
  side: Side
  team: string
  /** The clock counts down, so startBucket >= endBucket. */
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  frameStart?: number
  /** Buckets in this span where the other annotator named the same team. */
  agreedBuckets: number
}

/** A contiguous stretch where the two annotators name different defending teams. */
export interface DefenseDisagreement {
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  teamA: string
  teamB: string
  frameStart?: number
}

export interface DefenseComparison {
  /** Buckets present in BOTH documents, descending. */
  orderedBuckets: number[]
  spans: DefenseSpan[]
  /** Every distinct team named by either annotator, for stable colouring. */
  teams: string[]
  counts: {
    agree: number
    disagree: number
    /** Only one side recorded a team — a coverage gap, not a judgement clash. */
    missing: number
  }
  disagreements: DefenseDisagreement[]
}

const teamAt = (doc: AnnotationDocument, bucket: number): string | undefined =>
  doc.buckets.get(bucket)?.defTeam

/** Merge a side's consecutive same-team buckets into spans. */
function spansFor(
  doc: AnnotationDocument,
  other: AnnotationDocument,
  side: Side,
  orderedBuckets: number[],
): DefenseSpan[] {
  const out: DefenseSpan[] = []
  let run: number[] = []
  let team: string | undefined

  const flush = () => {
    if (run.length === 0 || team === undefined) { run = []; team = undefined; return }
    const startBucket = run[0]
    out.push({
      side,
      team,
      startBucket,
      endBucket: run[run.length - 1],
      bucketCount: run.length,
      durationS: parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
      frameStart: doc.buckets.get(startBucket)?.frameStart
        ?? other.buckets.get(startBucket)?.frameStart,
      agreedBuckets: run.filter(b => teamAt(other, b) === team).length,
    })
    run = []
    team = undefined
  }

  for (let i = 0; i < orderedBuckets.length; i++) {
    const bucket = orderedBuckets[i]
    const t = teamAt(doc, bucket)
    if (t === undefined) { flush(); continue }

    // A run breaks when the team changes, or when the buckets are not
    // adjacent in the data — a hole is a break, not a continuation.
    const adjacent = run.length === 0 || orderedBuckets[i - 1] === run[run.length - 1]
    if (team !== undefined && (team !== t || !adjacent)) flush()

    team = t
    run.push(bucket)
  }
  flush()

  return out
}

/** Run-length encode the buckets where the two name different teams. */
function disagreementsIn(
  docA: AnnotationDocument,
  docB: AnnotationDocument,
  orderedBuckets: number[],
): DefenseDisagreement[] {
  const out: DefenseDisagreement[] = []
  let run: number[] = []
  let pair: { a: string; b: string } | null = null

  const flush = () => {
    if (run.length === 0 || pair === null) { run = []; pair = null; return }
    const startBucket = run[0]
    out.push({
      startBucket,
      endBucket: run[run.length - 1],
      bucketCount: run.length,
      durationS: parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
      teamA: pair.a,
      teamB: pair.b,
      frameStart: docA.buckets.get(startBucket)?.frameStart
        ?? docB.buckets.get(startBucket)?.frameStart,
    })
    run = []
    pair = null
  }

  for (let i = 0; i < orderedBuckets.length; i++) {
    const bucket = orderedBuckets[i]
    const a = teamAt(docA, bucket)
    const b = teamAt(docB, bucket)
    // Only a genuine clash counts; a missing label on either side is a gap.
    if (a === undefined || b === undefined || a === b) { flush(); continue }

    const adjacent = run.length === 0 || orderedBuckets[i - 1] === run[run.length - 1]
    if (pair !== null && (pair.a !== a || pair.b !== b || !adjacent)) flush()

    pair = { a, b }
    run.push(bucket)
  }
  flush()

  return out
}

export function compareDefenseSpans(
  docA: AnnotationDocument,
  docB: AnnotationDocument,
): DefenseComparison {
  const orderedBuckets = [...docA.buckets.keys()]
    .filter(b => docB.buckets.has(b))
    .sort((x, y) => y - x)

  const counts = { agree: 0, disagree: 0, missing: 0 }
  const teams = new Set<string>()

  for (const bucket of orderedBuckets) {
    const a = teamAt(docA, bucket)
    const b = teamAt(docB, bucket)
    if (a !== undefined) teams.add(a)
    if (b !== undefined) teams.add(b)

    if (a === undefined || b === undefined) counts.missing++
    else if (a === b) counts.agree++
    else counts.disagree++
  }

  return {
    orderedBuckets,
    spans: [
      ...spansFor(docA, docB, 'a', orderedBuckets),
      ...spansFor(docB, docA, 'b', orderedBuckets),
    ],
    teams: [...teams].sort(),
    counts,
    disagreements: disagreementsIn(docA, docB, orderedBuckets),
  }
}
