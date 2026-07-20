import type { CellAnnotation, Player, AttackerId } from '../store/useStore'
import { getBucketDefendingTeamId } from './defenseTeam'

// Decide which annotations to carry forward into the (empty) current bucket.
// Pure function so the rules are unit-testable:
//  - nothing when auto-fill memory is switched off        (feature #3)
//  - nothing into dead-time buckets                       (feature #1)
//  - never copy across a defending-team swap barrier      (feature #2)
//  - never copy across a bucket annotated by the other team

export interface CarryForwardInput {
  currentBucket: number
  cellAnnotations: CellAnnotation[]
  playerDict: Record<number, Player>
  defendingTeamId: number
  autoFillMemory: boolean
  deadTimeBuckets: number[]
  memoryBarrierFrames: number[]
  bucketFrameStart: Map<number, number>
}

export interface CarryForwardFill {
  defenderId: number
  attackerId: AttackerId
  confidence?: 1 | 2 | 3
}

export function computeCarryForward(input: CarryForwardInput): CarryForwardFill[] {
  const {
    currentBucket, cellAnnotations, playerDict, defendingTeamId,
    autoFillMemory, deadTimeBuckets, memoryBarrierFrames, bucketFrameStart,
  } = input

  if (!autoFillMemory) return []
  if (deadTimeBuckets.includes(currentBucket)) return []

  const fills: CarryForwardFill[] = []
  const defenderIds = new Set(cellAnnotations.map(c => c.defenderId))

  for (const defId of defenderIds) {
    if (cellAnnotations.some(c => c.defenderId === defId && c.shotClockBucket === currentBucket)) continue

    // Clock counts down during play, so "preceding" bucket has a higher value;
    // pick this defender's own closest preceding annotated bucket.
    const prevAnn = cellAnnotations
      .filter(c => c.defenderId === defId && c.shotClockBucket > currentBucket)
      .sort((a, b) => a.shotClockBucket - b.shotClockBucket)[0]
    if (!prevAnn) continue

    // Don't carry assignments across a defending-team swap boundary
    const prevDefTeamId = getBucketDefendingTeamId(prevAnn.shotClockBucket, cellAnnotations, playerDict, defendingTeamId)
    if (prevDefTeamId !== defendingTeamId) continue

    // Don't carry across a swap barrier: barrier frame lies between the source
    // bucket and the current bucket (frame indices increase over time)
    const prevStart = bucketFrameStart.get(prevAnn.shotClockBucket)
    const curStart  = bucketFrameStart.get(currentBucket)
    if (prevStart !== undefined && curStart !== undefined &&
        memoryBarrierFrames.some(f => prevStart < f && f <= curStart)) continue

    fills.push({ defenderId: defId, attackerId: prevAnn.attackerId, confidence: prevAnn.confidence })
  }

  return fills
}
