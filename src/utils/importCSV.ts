import { v4 as uuid } from 'uuid'
import type { CellAnnotation, AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

// Parse a previously exported per-frame annotation CSV (exportFrameCSV) back
// into CellAnnotation[]. One annotation is kept per (defender, bucket) pair —
// duplicate frame rows for the same bucket collapse to a single entry.
export function parseAnnotationCSV(csvText: string, isQuarter: boolean): CellAnnotation[] {
  const lines = csvText.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())

  const iStatus       = headers.indexOf('gamestatus')
  const iDefenderId   = headers.indexOf('defender_id')
  const iAttackerId   = headers.indexOf('attacker_id')
  const iQuarterClock = headers.indexOf('quarter_clock')
  const iShotClock    = headers.indexOf('shot_clock')

  const seen = new Map<string, CellAnnotation>()

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols[iStatus] !== 'active') continue

    const defenderId = parseInt(cols[iDefenderId])
    if (isNaN(defenderId)) continue

    const attRaw = cols[iAttackerId]
    if (!attRaw) continue
    const attackerId: AttackerId = attRaw === 'GUARD_NONE' ? 'GUARD_NONE' : parseInt(attRaw)
    if (typeof attackerId === 'number' && isNaN(attackerId)) continue

    let bucket: number
    if (isQuarter) {
      const qc = parseFloat(cols[iQuarterClock])
      if (isNaN(qc)) continue
      bucket = Math.round(Math.floor(qc / QUARTER_BUCKET_S) * QUARTER_BUCKET_S * 1e6) / 1e6
    } else {
      const sc = parseFloat(cols[iShotClock])
      if (isNaN(sc)) continue
      bucket = Math.floor(sc)
    }

    const key = `${defenderId}_${bucket}`
    if (!seen.has(key)) {
      seen.set(key, { id: uuid(), defenderId, attackerId, shotClockBucket: bucket })
    }
  }

  return Array.from(seen.values())
}
