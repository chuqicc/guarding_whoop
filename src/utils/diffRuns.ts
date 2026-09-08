import type { CellComparison, CellStatus } from './agreement'
import type { AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

/**
 * One run of consecutive buckets that share an agreement status for one
 * defender. Encoding runs rather than cells keeps a full quarter to a few
 * hundred bars instead of ~14,000 — and reads better too: "these twelve
 * buckets agree" is one green bar, not twelve.
 */
export interface DiffRun {
  defenderId: number
  status: CellStatus
  startBucket: number
  endBucket: number
  bucketCount: number
  durationS: number
  a?: AttackerId
  b?: AttackerId
}

/** True for the statuses a reviewer actually wants to step through. */
export const isReviewable = (s: CellStatus) =>
  s === 'disagree' || s === 'coverage-mismatch' || s === 'defense-mismatch'

/** Collapse per-cell comparisons into per-defender runs of equal status. */
export function buildDiffRuns(cells: CellComparison[], orderedBuckets: number[]): DiffRun[] {
  const order = new Map(orderedBuckets.map((b, i) => [b, i]))
  const byDefender = new Map<number, CellComparison[]>()
  for (const c of cells) {
    const list = byDefender.get(c.defenderId)
    if (list) list.push(c)
    else byDefender.set(c.defenderId, [c])
  }

  const runs: DiffRun[] = []
  for (const [defenderId, list] of byDefender) {
    list.sort((x, y) => (order.get(x.bucket) ?? 0) - (order.get(y.bucket) ?? 0))

    let run: CellComparison[] = []
    const flush = () => {
      if (run.length === 0) return
      const first = run[0]
      const last = run[run.length - 1]
      runs.push({
        defenderId,
        status: first.status,
        startBucket: first.bucket,
        endBucket: last.bucket,
        bucketCount: run.length,
        durationS: parseFloat((run.length * QUARTER_BUCKET_S).toFixed(3)),
        a: first.a,
        b: first.b,
      })
      run = []
    }

    for (const c of list) {
      const prev = run[run.length - 1]
      const contiguous = prev !== undefined &&
        (order.get(c.bucket) ?? -1) === (order.get(prev.bucket) ?? -2) + 1
      // A run must also agree on WHICH answers differ, otherwise two unrelated
      // disagreements would merge into one misleading bar.
      const sameAnswers = prev !== undefined && prev.a === c.a && prev.b === c.b
      if (prev && contiguous && prev.status === c.status && sameAnswers) run.push(c)
      else { flush(); run = [c] }
    }
    flush()
  }

  return runs.sort(
    (x, y) => (order.get(x.startBucket)! - order.get(y.startBucket)!) || (x.defenderId - y.defenderId),
  )
}

