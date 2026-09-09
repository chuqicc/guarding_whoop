import { v4 as uuid } from 'uuid'
import type { CellAnnotation } from '../store/useStore'
import type { ImportedAnnotations } from './importJSON'
import { parseAnnotationDocument } from './annotationDocument'

/**
 * Parse a previously exported per-frame annotation CSV back into store shape.
 *
 * This used to return assignments only, so importing a CSV silently dropped the
 * Dead / Shot / Rebound marks even though every one of those columns is present
 * in the file — the JSON path restored them and the CSV path did not. Both now
 * go through parseAnnotationDocument, which is the one place that understands
 * either export format, so the two paths cannot drift apart again.
 *
 * One annotation is kept per (defender, bucket); duplicate frame rows for the
 * same bucket collapse to a single entry.
 */
export function parseAnnotationCSV(csvText: string): ImportedAnnotations {
  const doc = parseAnnotationDocument(csvText)

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
