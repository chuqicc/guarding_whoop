import type { TrackingFrame, SyncPoint, GapInfo } from '../store/useStore'

export function detectGaps(frames: TrackingFrame[], threshold = 0.1): GapInfo[] {
  const gaps: GapInfo[] = []
  for (let i = 0; i < frames.length - 1; i++) {
    const drop = frames[i].quarterClock - frames[i + 1].quarterClock
    if (drop > threshold) gaps.push({ frameIndex: i, clockJump: drop })
  }
  return gaps
}

// Returns null when no sync points have been set yet (caller should skip seeking).
export function getVideoTimeForFrame(frame: number, syncPoints: SyncPoint[]): number | null {
  if (!syncPoints.length) return null
  const sorted = [...syncPoints].sort((a, b) => a.frame - b.frame)
  // Find the latest sync point whose frame <= target frame
  let best = sorted[0]
  for (const sp of sorted) { if (sp.frame <= frame) best = sp }
  return Math.max(0, best.videoTime + (frame - best.frame) * 0.04)
}
