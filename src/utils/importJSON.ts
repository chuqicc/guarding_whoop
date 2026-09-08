import { v4 as uuid } from 'uuid'
import type { CellAnnotation, AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { parseAnnotationDocument } from './annotationDocument'

// Parse previously exported annotation JSON back into store shape.
// Supports three formats:
//   v2     — { format: 'guard-annotation/v2', buckets: [...] }   (current)
//   v1     — { metadata, frames: [{ gamestatus, assignments }] } (old per-frame)
//   legacy — { pairs: [{ defender_id, attacker_id, shot_clock_second }] }

export interface ImportedAnnotations {
  annotations: CellAnnotation[]
  deadTimeBuckets?: number[]
  shotBuckets?: number[]
  reboundBuckets?: number[]
}

export function parseAnnotationJSON(text: string): ImportedAnnotations {
  const data = JSON.parse(text)

  if (Array.isArray(data?.buckets)) return parseV2(text)
  if (Array.isArray(data?.frames))  return parseV1(data)
  if (Array.isArray(data?.pairs))   return parseLegacyPairs(data)

  throw new Error('Unrecognized annotation JSON format')
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// v2 is parsed once, by parseAnnotationDocument, and projected down to the
// resume-shape here. Parsing the same format in two places is how the two
// copies drift apart.
function parseV2(text: string): ImportedAnnotations {
  const doc = parseAnnotationDocument(text)
  const annotations: CellAnnotation[] = []
  const deadTimeBuckets: number[] = []
  const shotBuckets: number[] = []
  const reboundBuckets: number[] = []

  for (const [bucket, b] of doc.buckets) {
    if (b.status === 'dead') deadTimeBuckets.push(bucket)
    if (b.shot) shotBuckets.push(bucket)
    if (b.rebound) reboundBuckets.push(bucket)
    for (const [defenderId, attackerId] of b.assignments) {
      annotations.push({
        id: uuid(),
        defenderId,
        attackerId,
        shotClockBucket: bucket,
        confidence: b.confidence.get(defenderId),
      })
    }
  }

  return { annotations, deadTimeBuckets, shotBuckets, reboundBuckets }
}

function parseV1(data: any): ImportedAnnotations {
  const seen = new Map<string, CellAnnotation>()
  const deadTimeBuckets = new Set<number>()

  for (const f of data.frames) {
    const qc = parseFloat(f.quarter_clock)
    if (isNaN(qc)) continue
    const bucket = Math.round(Math.floor(qc / QUARTER_BUCKET_S) * QUARTER_BUCKET_S * 1e6) / 1e6

    if (f.gamestatus === 'dead') { deadTimeBuckets.add(bucket); continue }
    if (!Array.isArray(f.assignments)) continue

    for (const a of f.assignments) {
      const defenderId = Number(a.defender_id)
      if (isNaN(defenderId)) continue
      if (a.attacker_id === null || a.attacker_id === undefined) continue
      const attackerId: AttackerId = a.attacker_id === 'GUARD_NONE' ? 'GUARD_NONE' : Number(a.attacker_id)
      if (typeof attackerId === 'number' && isNaN(attackerId)) continue

      const key = `${defenderId}_${bucket}`
      if (!seen.has(key)) {
        const conf = a.confidence
        seen.set(key, {
          id: uuid(), defenderId, attackerId, shotClockBucket: bucket,
          confidence: conf === 1 || conf === 2 || conf === 3 ? conf : undefined,
        })
      }
    }
  }

  return { annotations: [...seen.values()], deadTimeBuckets: [...deadTimeBuckets] }
}

function parseLegacyPairs(data: any): ImportedAnnotations {
  const annotations: CellAnnotation[] = data.pairs.map((p: any) => ({
    id: (p.id as string) ?? uuid(),
    defenderId: p.defender_id as number,
    attackerId: p.attacker_id === null ? 'GUARD_NONE' as const : p.attacker_id as number,
    shotClockBucket: p.shot_clock_second as number,
    confidence: p.confidence === 1 || p.confidence === 2 || p.confidence === 3 ? p.confidence : undefined,
  }))
  return { annotations }
}
