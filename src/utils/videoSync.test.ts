import { describe, it, expect } from 'vitest'
import {
  videoTimeFor, frameForVideoTime, syncMatchesVideo, formatOffset, type VideoSync,
} from './videoSync'
import type { TrackingFrame } from '../store/useStore'

// Real values from 0021500381.json — the first Q1 moment.
const T0 = 1450323792107

const sync: VideoSync = {
  momentId: T0,
  videoTime: 30,          // the clip shows that instant 30s in
  videoName: 'q1.mp4',
  videoSize: 12345,
}

describe('videoTimeFor', () => {
  it('returns the anchor itself at the anchor moment', () => {
    expect(videoTimeFor(sync, T0)).toEqual({ time: 30, outOfRange: null })
  })

  it('advances one video second per tracking second', () => {
    expect(videoTimeFor(sync, T0 + 10_000).time).toBeCloseTo(40)
    expect(videoTimeFor(sync, T0 - 10_000).time).toBeCloseTo(20)
  })

  it('stays correct across a 195-second stoppage', () => {
    // The load-bearing property. In the real file the largest Q1 gap is 195.2s
    // of wall clock during which the game clock does not move — a game-clock
    // mapping would be 195s adrift after it; Unix time is not.
    const beforeStoppage = T0 + 300_000
    const afterStoppage = beforeStoppage + 195_200
    const a = videoTimeFor(sync, beforeStoppage).time
    const b = videoTimeFor(sync, afterStoppage).time
    expect(b - a).toBeCloseTo(195.2, 3)
  })

  it('accumulates no error over a whole quarter', () => {
    // Q1 of the real file spans 1343.1s of wall clock.
    const end = T0 + 1_343_100
    expect(videoTimeFor(sync, end).time).toBeCloseTo(30 + 1343.1, 3)
  })

  it('reports a moment before the clip starts, rather than silently parking at 0', () => {
    // Ordinary: a single-quarter clip usually begins after the tracking does.
    const early: VideoSync = { ...sync, videoTime: 2 }
    expect(videoTimeFor(early, T0 - 10_000)).toEqual({ time: 0, outOfRange: 'before' })
  })

  it('reports a moment past the end of the clip', () => {
    expect(videoTimeFor(sync, T0 + 600_000, 120)).toEqual({ time: 120, outOfRange: 'after' })
  })

  it('does not clamp when the duration is unknown', () => {
    expect(videoTimeFor(sync, T0 + 600_000).outOfRange).toBeNull()
  })

  it('treats a zero duration as unknown rather than clamping everything', () => {
    // <video> reports 0 before metadata loads.
    expect(videoTimeFor(sync, T0 + 10_000, 0).outOfRange).toBeNull()
  })
})

describe('frameForVideoTime', () => {
  const frames: TrackingFrame[] = [0, 1, 2, 3].map(i => ({
    frameIndex: i, momentId: T0 + i * 40, quarterClock: 720 - i * 0.04, shotClock: 24,
    ballX: 0, ballY: 0, ballZ: 0, players: [],
  }))

  it('finds the frame at the anchor', () => {
    expect(frameForVideoTime(frames, sync, 30)).toBe(0)
  })

  it('takes the nearest frame, not an exact match', () => {
    // 30.05s => 50ms past T0; frame 1 is at 40ms, frame 2 at 80ms.
    expect(frameForVideoTime(frames, sync, 30.05)).toBe(1)
  })

  it('clamps to the ends rather than returning nothing', () => {
    expect(frameForVideoTime(frames, sync, 0)).toBe(0)
    expect(frameForVideoTime(frames, sync, 9999)).toBe(3)
  })

  it('returns null for no frames', () => {
    expect(frameForVideoTime([], sync, 30)).toBeNull()
  })

  it('ignores frames with no timestamp', () => {
    const mixed: TrackingFrame[] = [
      { ...frames[0], momentId: undefined },
      frames[1],
    ]
    expect(frameForVideoTime(mixed, sync, 30)).toBe(1)
  })

  it('round-trips with videoTimeFor', () => {
    const t = videoTimeFor(sync, frames[2].momentId!).time
    expect(frameForVideoTime(frames, sync, t)).toBe(2)
  })
})

describe('syncMatchesVideo', () => {
  it('accepts the same file', () => {
    expect(syncMatchesVideo(sync, 'q1.mp4', 12345)).toBe(true)
  })

  it('rejects a different file, which would be silently wrong', () => {
    // Same name, different content — a re-export of another quarter.
    expect(syncMatchesVideo(sync, 'q1.mp4', 99999)).toBe(false)
    expect(syncMatchesVideo(sync, 'q2.mp4', 12345)).toBe(false)
  })
})

describe('formatOffset', () => {
  it('states where the tracking starts within the clip', () => {
    // Anchored 30s in, at the very first moment.
    expect(formatOffset(sync, T0)).toBe('+30.0s')
  })

  it('handles an anchor taken later in the quarter', () => {
    // Anchored 90s into the clip, 60s of tracking after the start.
    const later: VideoSync = { ...sync, momentId: T0 + 60_000, videoTime: 90 }
    expect(formatOffset(later, T0)).toBe('+30.0s')
  })

  it('reports a negative offset when the clip starts mid-tracking', () => {
    const late: VideoSync = { ...sync, momentId: T0 + 60_000, videoTime: 10 }
    expect(formatOffset(late, T0)).toBe('-50.0s')
  })

  it('falls back to the raw anchor time with no tracking reference', () => {
    expect(formatOffset(sync, undefined)).toBe('30.0s')
  })
})
