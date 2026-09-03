import type { CellAnnotation, AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

/**
 * A marking spell: one defender continuously guarding one attacker.
 *
 * The 0.5s bucket is how the work is *entered*; the spell is the unit the
 * analysis actually cares about ("#23 marked #7 for 6.5s, then switched").
 * Spells are always DERIVED from cells and never stored — editing a single
 * bucket has to be able to split a spell in two, so cells stay the source of
 * truth and this recomputes.
 */
export interface MarkingSpell {
  defenderId: number
  attackerId: AttackerId
  /** Quarter clock counts DOWN, so startBucket >= endBucket numerically. */
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  startFrame?: number
  endFrame?: number
  /** Lowest confidence recorded anywhere in the spell — the weakest link. */
  minConfidence: 1 | 2 | 3
  /** Why the spell ended. */
  endedBy: SpellBreak
}

export type SpellBreak =
  | 'switch'       // same defender, different attacker in the very next bucket
  | 'gap'          // next bucket exists but was never annotated
  | 'dead-ball'    // play stopped
  | 'swap'         // defending team changed (memory barrier)
  | 'end'          // ran out of buckets

export interface SpellInput {
  cellAnnotations: CellAnnotation[]
  /** Every bucket that has tracking data, DESCENDING (clock counts down). */
  allBuckets: number[]
  deadTimeBuckets: number[]
  memoryBarrierFrames: number[]
  bucketFrameStart: Map<number, number>
}

/**
 * Group a defender's per-bucket assignments into contiguous spells.
 *
 * Two annotations continue the same spell only when all of these hold:
 *   - same attacker
 *   - the buckets are adjacent in the tracking data (a bucket with no frames
 *     is not a gap; a bucket with frames but no annotation is)
 *   - no dead-ball bucket between them
 *   - no defending-team swap barrier between them
 */
export function computeMarkingSpells(input: SpellInput): MarkingSpell[] {
  const { cellAnnotations, allBuckets, deadTimeBuckets, memoryBarrierFrames, bucketFrameStart } = input

  // Position in the descending bucket list == position in time.
  const order = new Map<number, number>()
  allBuckets.forEach((b, i) => order.set(b, i))
  const deadSet = new Set(deadTimeBuckets)

  const byDefender = new Map<number, CellAnnotation[]>()
  for (const c of cellAnnotations) {
    if (!order.has(c.shotClockBucket)) continue   // annotation with no tracking data
    const list = byDefender.get(c.defenderId)
    if (list) list.push(c)
    else byDefender.set(c.defenderId, [c])
  }

  const spells: MarkingSpell[] = []

  for (const [defenderId, anns] of byDefender) {
    anns.sort((a, b) => order.get(a.shotClockBucket)! - order.get(b.shotClockBucket)!)

    let run: CellAnnotation[] = [anns[0]]

    const flush = (endedBy: SpellBreak) => {
      const first = run[0]
      const last  = run[run.length - 1]
      spells.push({
        defenderId,
        attackerId: first.attackerId,
        startBucket: first.shotClockBucket,
        endBucket:   last.shotClockBucket,
        bucketCount: run.length,
        durationS:   parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
        startFrame:  bucketFrameStart.get(first.shotClockBucket),
        endFrame:    bucketFrameStart.get(last.shotClockBucket),
        minConfidence: run.reduce<1 | 2 | 3>(
          (min, c) => Math.min(min, c.confidence ?? 3) as 1 | 2 | 3, 3,
        ),
        endedBy,
      })
      run = []
    }

    for (let i = 1; i < anns.length; i++) {
      const prev = anns[i - 1]
      const cur  = anns[i]
      const brk = breakBetween(prev, cur, order, deadSet, allBuckets, memoryBarrierFrames, bucketFrameStart)
      if (brk === null) { run.push(cur); continue }
      flush(brk)
      run = [cur]
    }
    flush('end')
  }

  // Chronological, then by defender, so the output is stable to compare.
  return spells.sort(
    (a, b) => (order.get(a.startBucket)! - order.get(b.startBucket)!) || (a.defenderId - b.defenderId),
  )
}

function breakBetween(
  prev: CellAnnotation,
  cur: CellAnnotation,
  order: Map<number, number>,
  deadSet: Set<number>,
  allBuckets: number[],
  memoryBarrierFrames: number[],
  bucketFrameStart: Map<number, number>,
): SpellBreak | null {
  const pi = order.get(prev.shotClockBucket)!
  const ci = order.get(cur.shotClockBucket)!

  // A swap barrier anywhere between the two buckets ends the spell, even if
  // the assignment happens to look identical either side of it.
  const prevStart = bucketFrameStart.get(prev.shotClockBucket)
  const curStart  = bucketFrameStart.get(cur.shotClockBucket)
  if (prevStart !== undefined && curStart !== undefined &&
      memoryBarrierFrames.some(f => prevStart < f && f <= curStart)) return 'swap'

  if (ci > pi + 1) {
    // Something sits between them: dead ball outranks a plain gap.
    for (let i = pi + 1; i < ci; i++) {
      if (deadSet.has(allBuckets[i])) return 'dead-ball'
    }
    return 'gap'
  }

  if (prev.attackerId !== cur.attackerId) return 'switch'
  return null
}

/** Total time each defender spent marking each attacker, for quick QC. */
export function summariseSpells(spells: MarkingSpell[]) {
  return {
    count: spells.length,
    totalSeconds: parseFloat(spells.reduce((t, s) => t + s.durationS, 0).toFixed(3)),
    medianSeconds: median(spells.map(s => s.durationS)),
    switches: spells.filter(s => s.endedBy === 'switch').length,
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return parseFloat((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(3))
}
