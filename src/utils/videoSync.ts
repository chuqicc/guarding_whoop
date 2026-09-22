import type { TrackingFrame } from '../store/useStore'

/**
 * Mapping tracking time onto video time from a single manual anchor.
 *
 * `momentId` is an absolute Unix-ms timestamp, and — verified against real
 * SportVU files — it keeps running through stoppages: in one quarter the
 * timestamps span 22.4 minutes while the game clock advances only 12, the
 * difference being dead-ball time the tracking simply does not record. The
 * game clock stops and the frame index jumps at every gap, so neither can be
 * mapped onto a video; Unix time can, because the video runs on the same
 * wall clock.
 *
 * A video file carries no absolute time of its own, so the first anchor has to
 * come from a person. After that everything is arithmetic, and it does not
 * drift across stoppages — which is the whole point.
 */

export interface VideoSync {
  /** The tracking moment the anchor was taken at. */
  momentId: number
  /** The video position, in seconds, showing that same instant. */
  videoTime: number
  /** Guards against applying an anchor to a different video; see syncMatchesVideo. */
  videoName: string
  videoSize: number
}

export type OutOfRange = 'before' | 'after' | null

/**
 * Where in the video a tracking moment falls.
 *
 * A negative result is ordinary, not an error: a single-quarter clip usually
 * starts after the tracking does. The caller gets the clamped value plus which
 * end it fell off, so it can say so rather than silently parking at 0.
 */
export function videoTimeFor(
  sync: VideoSync,
  momentId: number,
  duration?: number,
): { time: number; outOfRange: OutOfRange } {
  const raw = sync.videoTime + (momentId - sync.momentId) / 1000

  if (raw < 0) return { time: 0, outOfRange: 'before' }
  if (duration !== undefined && duration > 0 && raw > duration) {
    return { time: duration, outOfRange: 'after' }
  }
  return { time: raw, outOfRange: null }
}

/** The inverse: which tracking frame a video position corresponds to. */
export function frameForVideoTime(
  frames: TrackingFrame[],
  sync: VideoSync,
  videoTime: number,
): number | null {
  if (frames.length === 0) return null
  const targetMoment = sync.momentId + (videoTime - sync.videoTime) * 1000

  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < frames.length; i++) {
    const m = frames[i].momentId
    if (m === undefined) continue
    const d = Math.abs(m - targetMoment)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return bestDist === Infinity ? null : best
}

/**
 * Whether an anchor belongs to the video currently loaded.
 *
 * Blob URLs do not survive a reload, so the video is always re-dropped. An
 * anchor restored onto a *different* file would be silently wrong — the
 * picture would not match and nothing would say why — so the file has to
 * identify itself before the anchor is reused.
 */
export function syncMatchesVideo(sync: VideoSync, name: string, size: number): boolean {
  return sync.videoName === name && sync.videoSize === size
}

/** Human-readable anchor offset, e.g. "+12.4s". */
export function formatOffset(sync: VideoSync, firstMomentId: number | undefined): string {
  if (firstMomentId === undefined) return `${sync.videoTime.toFixed(1)}s`
  const atStart = sync.videoTime - (sync.momentId - firstMomentId) / 1000
  return `${atStart >= 0 ? '+' : ''}${atStart.toFixed(1)}s`
}
