import type { AttackerId, CellAnnotation } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { computeMarkingSpells } from './spells'
import type { AnnotationDocument } from './annotationDocument'

/**
 * Inter-rater reliability between exactly two annotators of the same quarter.
 *
 * Three metrics, deliberately ordered by how much you should trust them:
 *
 *  1. Raw agreement — interpretable, and the denominator is always stated.
 *  2. Cohen's kappa — reported WITH its marginals, because with ~6 near-uniform
 *     categories the chance correction barely moves the number. Saying so is a
 *     fine result; hiding it invites a methods objection.
 *  3. Switch-event agreement — the one that actually characterises quality.
 *     Carry-forward copies an assignment across ~85% of buckets, so adjacent
 *     cells are massively autocorrelated and any cell-level number is inflated.
 *     Comparing the *events* sidesteps that.
 *
 * Every excluded cell is counted and reported. Silently dropping cells from a
 * denominator is how a reliability figure becomes wrong rather than merely
 * imprecise.
 */

export type CellStatus =
  | 'agree'
  | 'disagree'
  | 'coverage-mismatch'   // one annotator left it blank
  | 'dead-excluded'       // at least one marked the bucket dead
  | 'defense-mismatch'    // the two disagree about which team was defending

export interface CellComparison {
  bucket: number
  defenderId: number
  a?: AttackerId
  b?: AttackerId
  status: CellStatus
}

export interface SwitchEventAgreement {
  toleranceBuckets: number
  nA: number
  nB: number
  matched: number
  /** Neither annotator is ground truth; A is the nominal reference. F1 is symmetric. */
  precision: number
  recall: number
  f1: number
  /** Signed median of (A − B) in buckets. Positive = A marked the switch earlier. */
  medianOffsetBuckets: number | null
}

export interface DefenderAgreement {
  defenderId: number
  nCompared: number
  nAgree: number
  rawAgreement: number
  kappa: number | null
}

export interface AgreementReport {
  annotatorA: string
  annotatorB: string
  gameId: string
  quarter: number

  nCompared: number
  nAgree: number
  nDisagree: number
  nDeadExcluded: number
  nCoverageMismatch: number
  nDefenseMismatch: number

  rawAgreement: number
  kappaPooled: number | null
  kappaMeanPerDefender: number | null
  /** Category counts for each annotator, so chance agreement is visible. */
  marginals: Array<{ category: string; aCount: number; bCount: number }>

  perDefender: DefenderAgreement[]
  deadLive: { nCompared: number; agreement: number; kappa: number | null }
  switchEvents: SwitchEventAgreement
  defenseMismatchBuckets: number[]

  cells: CellComparison[]
  caveats: string[]
}

export interface AgreementOptions {
  /** Matching window for switch events. 2 buckets = ±1s at 0.5s buckets. */
  toleranceBuckets?: number
}

const catKey = (a: AttackerId): string => (a === 'GUARD_NONE' ? 'NONE' : String(a))

// ── Cohen's kappa ──────────────────────────────────────────────────────────

/**
 * Returns null when kappa is undefined: if both annotators used exactly one
 * category, expected agreement is 1 and the formula divides by zero. That is a
 * real property of the data, not an error, and must not be shown as 0.
 */
export function cohensKappa(pairs: Array<[string, string]>): number | null {
  const n = pairs.length
  if (n === 0) return null

  const cats = new Set<string>()
  for (const [a, b] of pairs) { cats.add(a); cats.add(b) }

  let observed = 0
  const aCount = new Map<string, number>()
  const bCount = new Map<string, number>()
  for (const [a, b] of pairs) {
    if (a === b) observed++
    aCount.set(a, (aCount.get(a) ?? 0) + 1)
    bCount.set(b, (bCount.get(b) ?? 0) + 1)
  }

  const po = observed / n
  let pe = 0
  for (const c of cats) pe += ((aCount.get(c) ?? 0) / n) * ((bCount.get(c) ?? 0) / n)

  if (pe >= 1) return null
  return (po - pe) / (1 - pe)
}

// ── Switch events ──────────────────────────────────────────────────────────

/** Rebuild CellAnnotation[] from a document so the spell derivation can be reused. */
function cellsOf(doc: AnnotationDocument): CellAnnotation[] {
  const out: CellAnnotation[] = []
  for (const [bucket, b] of doc.buckets) {
    for (const [defenderId, attackerId] of b.assignments) {
      out.push({
        id: `${defenderId}_${bucket}`,
        defenderId,
        attackerId,
        shotClockBucket: bucket,
        confidence: b.confidence.get(defenderId),
      })
    }
  }
  return out
}

/**
 * memoryBarrierFrames (recorded when the annotator swaps which team is
 * defending) is NOT part of either export format, so it cannot be recovered
 * from a file. A change of `def_team` between adjacent buckets is the closest
 * available proxy, and it IS exported. Spells derived here can therefore
 * differ slightly from those shown in-app during annotation.
 */
function barrierFramesOf(doc: AnnotationDocument, orderedBuckets: number[]): number[] {
  const barriers: number[] = []
  for (let i = 1; i < orderedBuckets.length; i++) {
    const prev = doc.buckets.get(orderedBuckets[i - 1])
    const cur = doc.buckets.get(orderedBuckets[i])
    if (!prev || !cur || !prev.defTeam || !cur.defTeam) continue
    if (prev.defTeam !== cur.defTeam && cur.frameStart !== undefined) barriers.push(cur.frameStart)
  }
  return barriers.sort((a, b) => a - b)
}

/** Buckets at which a defender began marking a new attacker after a switch. */
export function switchEventsOf(
  doc: AnnotationDocument,
  allBuckets: number[],
  bucketFrameStart: Map<number, number>,
): Map<number, number[]> {
  const deadTimeBuckets = [...doc.buckets.entries()]
    .filter(([, b]) => b.status === 'dead')
    .map(([k]) => k)

  const spells = computeMarkingSpells({
    cellAnnotations: cellsOf(doc),
    allBuckets,
    deadTimeBuckets,
    memoryBarrierFrames: barrierFramesOf(doc, allBuckets),
    bucketFrameStart,
  })

  const order = new Map(allBuckets.map((b, i) => [b, i]))
  const byDefender = new Map<number, typeof spells>()
  for (const s of spells) {
    const list = byDefender.get(s.defenderId)
    if (list) list.push(s)
    else byDefender.set(s.defenderId, [s])
  }

  const events = new Map<number, number[]>()
  for (const [defenderId, list] of byDefender) {
    list.sort((a, b) => order.get(a.startBucket)! - order.get(b.startBucket)!)
    const times: number[] = []
    for (let i = 1; i < list.length; i++) {
      // Only a genuine switch counts. A spell that ended at a dead ball or a
      // defence swap is a break in the data, not a decision to change target.
      if (list[i - 1].endedBy === 'switch') times.push(list[i].startBucket)
    }
    events.set(defenderId, times)
  }
  return events
}

/** Greedy nearest-first matching of two event lists within a tolerance. */
function matchEvents(a: number[], b: number[], toleranceValue: number) {
  const usedB = new Set<number>()
  const offsets: number[] = []

  for (const ta of [...a].sort((x, y) => y - x)) {
    let best = -1
    let bestDist = Infinity
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue
      const d = Math.abs(ta - b[j])
      if (d <= toleranceValue && d < bestDist) { bestDist = d; best = j }
    }
    if (best !== -1) { usedB.add(best); offsets.push(ta - b[best]) }
  }
  return { matched: offsets.length, offsets }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── The report ─────────────────────────────────────────────────────────────

export function computeAgreement(
  docA: AnnotationDocument,
  docB: AnnotationDocument,
  opts: AgreementOptions = {},
): AgreementReport {
  const toleranceBuckets = opts.toleranceBuckets ?? 2

  const allBuckets = [...new Set([...docA.buckets.keys(), ...docB.buckets.keys()])]
    .sort((x, y) => y - x)   // clock counts down

  const bucketFrameStart = new Map<number, number>()
  for (const b of allBuckets) {
    const fa = docA.buckets.get(b)?.frameStart
    const fb = docB.buckets.get(b)?.frameStart
    const f = fa ?? fb
    if (f !== undefined) bucketFrameStart.set(b, f)
  }

  const cells: CellComparison[] = []
  const defenseMismatchBuckets: number[] = []
  const pairs: Array<[string, string]> = []
  const pairsByDefender = new Map<number, Array<[string, string]>>()
  const deadPairs: Array<[string, string]> = []

  let nAgree = 0, nDisagree = 0, nDeadExcluded = 0, nCoverageMismatch = 0, nDefenseMismatch = 0

  for (const bucket of allBuckets) {
    const ba = docA.buckets.get(bucket)
    const bb = docB.buckets.get(bucket)
    if (!ba || !bb) continue          // bucket absent from one file entirely

    if (ba.defTeam && bb.defTeam && ba.defTeam !== bb.defTeam) {
      defenseMismatchBuckets.push(bucket)
    }
    const defenseMismatch = defenseMismatchBuckets[defenseMismatchBuckets.length - 1] === bucket

    deadPairs.push([ba.status, bb.status])

    const isDead = ba.status === 'dead' || bb.status === 'dead'
    const defenders = new Set([...ba.assignments.keys(), ...bb.assignments.keys()])

    for (const defenderId of defenders) {
      const a = ba.assignments.get(defenderId)
      const b = bb.assignments.get(defenderId)

      // Order matters: a possession attributed to the wrong team is a
      // catastrophic disagreement, not a cell-level one, and a dead bucket is
      // outside the assignment denominator regardless of what is recorded.
      if (defenseMismatch) {
        nDefenseMismatch++
        cells.push({ bucket, defenderId, a, b, status: 'defense-mismatch' })
        continue
      }
      if (isDead) {
        nDeadExcluded++
        cells.push({ bucket, defenderId, a, b, status: 'dead-excluded' })
        continue
      }
      if (a === undefined || b === undefined) {
        nCoverageMismatch++
        cells.push({ bucket, defenderId, a, b, status: 'coverage-mismatch' })
        continue
      }

      const same = a === b
      if (same) nAgree++; else nDisagree++
      cells.push({ bucket, defenderId, a, b, status: same ? 'agree' : 'disagree' })

      const pair: [string, string] = [catKey(a), catKey(b)]
      pairs.push(pair)
      const list = pairsByDefender.get(defenderId)
      if (list) list.push(pair)
      else pairsByDefender.set(defenderId, [pair])
    }
  }

  const nCompared = nAgree + nDisagree

  // Marginals, so a reader can see for themselves how much room chance had.
  const aCount = new Map<string, number>()
  const bCount = new Map<string, number>()
  for (const [a, b] of pairs) {
    aCount.set(a, (aCount.get(a) ?? 0) + 1)
    bCount.set(b, (bCount.get(b) ?? 0) + 1)
  }
  const marginals = [...new Set([...aCount.keys(), ...bCount.keys()])]
    .sort()
    .map(category => ({
      category,
      aCount: aCount.get(category) ?? 0,
      bCount: bCount.get(category) ?? 0,
    }))

  const perDefender: DefenderAgreement[] = [...pairsByDefender.entries()]
    .map(([defenderId, ps]) => {
      const agree = ps.filter(([a, b]) => a === b).length
      return {
        defenderId,
        nCompared: ps.length,
        nAgree: agree,
        rawAgreement: ps.length ? agree / ps.length : 0,
        kappa: cohensKappa(ps),
      }
    })
    .sort((x, y) => x.defenderId - y.defenderId)

  const definedKappas = perDefender.map(d => d.kappa).filter((k): k is number => k !== null)

  // Switch events
  const evA = switchEventsOf(docA, allBuckets, bucketFrameStart)
  const evB = switchEventsOf(docB, allBuckets, bucketFrameStart)
  const toleranceValue = toleranceBuckets * QUARTER_BUCKET_S

  let nA = 0, nB = 0, matched = 0
  const offsets: number[] = []
  for (const defenderId of new Set([...evA.keys(), ...evB.keys()])) {
    const a = evA.get(defenderId) ?? []
    const b = evB.get(defenderId) ?? []
    nA += a.length
    nB += b.length
    const m = matchEvents(a, b, toleranceValue)
    matched += m.matched
    offsets.push(...m.offsets)
  }
  const precision = nB ? matched / nB : 0
  const recall = nA ? matched / nA : 0
  const medOffset = median(offsets)

  const deadAgree = deadPairs.filter(([a, b]) => a === b).length

  const caveats: string[] = [
    'Carry-forward auto-fills most buckets, so adjacent cells are highly ' +
    'autocorrelated and the cell-level figures are inflated. The switch-event ' +
    'F1 is the metric that characterises annotation quality.',
    'Cells that only one annotator filled in are reported separately as coverage ' +
    'mismatches and are excluded from kappa — counting them as a category, or as ' +
    'agreement, would corrupt the statistic.',
    'Defence-swap barriers are not present in either export format; a change of ' +
    'defending team between adjacent buckets is used as a proxy, so spells here ' +
    'can differ slightly from those shown during annotation.',
    'Agreement restricted to manually-entered cells is not available: the export ' +
    'does not record whether a cell was typed by the annotator or carried forward ' +
    'automatically. That would be the only figure free of carry-forward inflation.',
  ]
  if (docA.sourceFormat !== docB.sourceFormat) {
    caveats.push(
      `The two files are in different formats (${docA.sourceFormat} vs ${docB.sourceFormat}). ` +
      'Both carry the same annotation content, so this does not affect the figures.',
    )
  }

  return {
    annotatorA: docA.annotator,
    annotatorB: docB.annotator,
    gameId: docA.gameId,
    quarter: docA.quarter,

    nCompared, nAgree, nDisagree,
    nDeadExcluded, nCoverageMismatch, nDefenseMismatch,

    rawAgreement: nCompared ? nAgree / nCompared : 0,
    kappaPooled: cohensKappa(pairs),
    kappaMeanPerDefender: definedKappas.length
      ? definedKappas.reduce((s, k) => s + k, 0) / definedKappas.length
      : null,
    marginals,
    perDefender,

    deadLive: {
      nCompared: deadPairs.length,
      agreement: deadPairs.length ? deadAgree / deadPairs.length : 0,
      kappa: cohensKappa(deadPairs),
    },

    switchEvents: {
      toleranceBuckets,
      nA, nB, matched,
      precision, recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      medianOffsetBuckets: medOffset === null ? null : medOffset / QUARTER_BUCKET_S,
    },

    defenseMismatchBuckets,
    cells,
    caveats,
  }
}
