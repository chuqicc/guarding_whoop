import type { CellAnnotation, Player } from '../store/useStore'

// Determine which team was actually on defense for a given bucket, based on
// the defenderId(s) recorded in cellAnnotations for that bucket. Falls back
// to fallbackTeamId (the current global defendingTeamId) when the bucket has
// no annotations yet.
export function getBucketDefendingTeamId(
  bucket: number,
  cellAnnotations: CellAnnotation[],
  playerDict: Record<number, Player>,
  fallbackTeamId: number
): number {
  const annsForBucket = cellAnnotations.filter(c => c.shotClockBucket === bucket)
  if (annsForBucket.length === 0) return fallbackTeamId

  const matchingFallback = annsForBucket.find(
    c => playerDict[c.defenderId]?.teamId === fallbackTeamId
  )
  if (matchingFallback) return fallbackTeamId

  const firstDefender = playerDict[annsForBucket[0].defenderId]
  return firstDefender ? firstDefender.teamId : fallbackTeamId
}
