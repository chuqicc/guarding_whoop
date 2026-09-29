import type { TrackingFrame } from '../store/useStore'

/**
 * Mapping tracking time onto video time from manually placed anchors.
 *
 * `momentId` is an absolute Unix-ms timestamp, and — verified against real
 * SportVU files — it keeps running through stoppages: in one quarter the
 * timestamps span 22.4 minutes while the game clock advances only 12, the
 * difference being dead-ball time the tracking simply does not record. The
 * game clock stops and the frame index jumps at every gap, so neither can be
 * mapped onto a video; Unix time can, because the video runs on the same
 * wall clock.
 *
 * A video file carries no absolute time of its own, so anchors have to come
 * from a person.
 *
 * ── Why more than one ──────────────────────────────────────────────────────
 *
 * One anchor is enough only while the clip runs at wall-clock rate from end to
 * end. Broadcast clips usually do not: a quarter whose tracking spans 24
 * minutes of real time and 12 minutes of game clock arrives as a 15-20 minute
 * file, because some stoppages were cut out and others were not. No single
 * offset fits that — after each cut the whole mapping shifts by the length of
 * whatever was removed.
 *
 * Several anchors do fit it. Each one holds from where it was placed until the
 * next, so a cut is absorbed by anchoring again just after it. Anchors are
 * therefore forward-acting, not nearest-wins: "I fixed it here" should mean
 * everything from here on, and should never reach back and change footage the
 * annotator has already checked.
 */

export interface SyncAnchor {
  /** The tracking moment the anchor was taken at. */
  momentId: number
  /** The video position, in seconds, showing that same instant. */
  videoTime: number
  createdAt: string
}

export interface VideoSync {
  /** Guards against applying anchors to a different video; see syncMatchesVideo. */
  videoName: string
  videoSize: number
  /** Ascending by momentId — chronological, since momentId is wall-clock. */
  anchors: SyncAnchor[]
}

export type OutOfRange = 'before' | 'after' | null

/** Shape check for restoring from storage; the migration below handles v1. */
export function isVideoSync(v: unknown): v is VideoSync {
  if (!v || typeof v !== 'object') return false
  const s = v as VideoSync
  return typeof s.videoName === 'string'
    && typeof s.videoSize === 'number'
    && Array.isArray(s.anchors)
    && s.anchors.every(a =>
      a && typeof a.momentId === 'number' && typeof a.videoTime === 'number')
}

/**
 * Accepts the single-anchor shape this used to store.
 *
 * Without it, every saved anchor would fail validation on load and be
 * quarantined, which surfaces as a "saved data was unreadable" warning — a
 * frightening message for what is only a format change.
 */
export function migrateSync(v: unknown): VideoSync | null {
  if (isVideoSync(v)) return v
  if (!v || typeof v !== 'object') return null
  const old = v as { momentId?: unknown; videoTime?: unknown; videoName?: unknown; videoSize?: unknown }
  if (typeof old.momentId !== 'number' || typeof old.videoTime !== 'number') return null
  return {
    videoName: typeof old.videoName === 'string' ? old.videoName : '',
    videoSize: typeof old.videoSize === 'number' ? old.videoSize : 0,
    anchors: [{
      momentId: old.momentId,
      videoTime: old.videoTime,
      createdAt: new Date(0).toISOString(),
    }],
  }
}

export function emptySync(videoName: string, videoSize: number): VideoSync {
  return { videoName, videoSize, anchors: [] }
}

/** Add an anchor, replacing any already sitting on the same moment. */
export function addAnchor(sync: VideoSync, momentId: number, videoTime: number): VideoSync {
  const anchors = sync.anchors
    .filter(a => a.momentId !== momentId)
    .concat({ momentId, videoTime, createdAt: new Date().toISOString() })
    .sort((x, y) => x.momentId - y.momentId)
  return { ...sync, anchors }
}

export function removeAnchor(sync: VideoSync, momentId: number): VideoSync {
  return { ...sync, anchors: sync.anchors.filter(a => a.momentId !== momentId) }
}

/**
 * The anchor governing a moment: the last one placed at or before it.
 *
 * Moments earlier than every anchor fall back to the first — the alternative is
 * refusing to position the video at all, which is worse than being approximately
 * right before the annotator has reached that part of the clip.
 */
export function anchorFor(sync: VideoSync, momentId: number): SyncAnchor | null {
  if (sync.anchors.length === 0) return null
  let governing = sync.anchors[0]
  for (const a of sync.anchors) {
    if (a.momentId > momentId) break
    governing = a
  }
  return governing
}

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
  const anchor = anchorFor(sync, momentId)
  if (!anchor) return { time: 0, outOfRange: null }

  const raw = anchor.videoTime + (momentId - anchor.momentId) / 1000

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
  if (frames.length === 0 || sync.anchors.length === 0) return null

  // Anchors map tracking -> video, so inverting means picking the anchor whose
  // own segment contains this video position rather than reading one off.
  let anchor = sync.anchors[0]
  for (const a of sync.anchors) {
    if (a.videoTime > videoTime) break
    anchor = a
  }
  const targetMoment = anchor.momentId + (videoTime - anchor.videoTime) * 1000

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
 * Whether anchors belong to the video currently loaded.
 *
 * Blob URLs do not survive a reload, so the video is always re-dropped. Anchors
 * restored onto a *different* file would be silently wrong — the picture would
 * not match and nothing would say why — so the file has to identify itself
 * before they are reused.
 */
export function syncMatchesVideo(sync: VideoSync, name: string, size: number): boolean {
  return sync.videoName === name && sync.videoSize === size
}

/** Human-readable offset of the first anchor, e.g. "+12.4s". */
export function formatOffset(sync: VideoSync, firstMomentId: number | undefined): string {
  const first = sync.anchors[0]
  if (!first) return '—'
  if (firstMomentId === undefined) return `${first.videoTime.toFixed(1)}s`
  const atStart = first.videoTime - (first.momentId - firstMomentId) / 1000
  return `${atStart >= 0 ? '+' : ''}${atStart.toFixed(1)}s`
}

/** `m:ss.s` for a video position. */
export function fmtVideoTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
