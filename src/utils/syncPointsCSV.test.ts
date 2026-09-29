import { describe, it, expect } from 'vitest'
import { buildSyncPointsCSV } from './export'
import type { VideoSync } from './videoSync'
import type { QuarterMeta, TrackingFrame } from '../store/useStore'

const meta = {
  filename: '0021500017_Q1', gameId: '0021500017', quarter: 1,
  teamA: { teamId: 1, abbr: 'AAA', players: [] },
  teamB: { teamId: 2, abbr: 'BBB', players: [] },
  defendingTeamId: 1, totalFrames: 0, startClock: 720, endClock: 0,
} as QuarterMeta

const T = 1_700_000_000_000
// One frame every 40ms from 12:00, enough to cover the anchors below.
const frames: TrackingFrame[] = Array.from({ length: 6000 }, (_, i) => ({
  frameIndex: i, momentId: T + i * 40, quarterClock: 720 - i * 0.04,
  shotClock: 24, ballX: 0, ballY: 0, ballZ: 0, players: [],
}))

const rows = (csv: string) => {
  const [head, ...rest] = csv.split('\n')
  const cols = head.split(',')
  return rest.map(l => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i]])))
}

describe('sync points CSV', () => {
  it('emits only a header when nothing is anchored', () => {
    const csv = buildSyncPointsCSV(null, meta, frames)
    expect(csv.split('\n')).toHaveLength(1)
    expect(csv).toContain('clip_offset_s')
  })

  it('reports the game clock and video position of each anchor', () => {
    const sync: VideoSync = {
      videoName: 'q1.mp4', videoSize: 1,
      anchors: [{ momentId: T, videoTime: 30, createdAt: '2026-01-01T00:00:00.000Z' }],
    }
    const [r] = rows(buildSyncPointsCSV(sync, meta, frames))
    expect(r.clock).toBe('12:00.0')
    expect(r.moment_id).toBe(String(T))
    expect(r.video_time).toBe('0:30.0')
    expect(r.video_file).toBe('q1.mp4')
  })

  it('measures how much footage was cut between two anchors', () => {
    // 120s of real time passes; the video advances only 60s, so a minute of
    // play was edited out. That gap is the column worth exporting.
    const sync: VideoSync = {
      videoName: 'q1.mp4', videoSize: 1,
      anchors: [
        { momentId: T, videoTime: 30, createdAt: 'x' },
        { momentId: T + 120_000, videoTime: 90, createdAt: 'x' },
      ],
    }
    const r = rows(buildSyncPointsCSV(sync, meta, frames))
    expect(r[0].clip_offset_s).toBe('30')
    expect(r[0].cut_before_s).toBe('')      // nothing precedes the first
    expect(r[1].clip_offset_s).toBe('-30')
    expect(r[1].cut_before_s).toBe('60')
  })

  it('reports no cut when the clip runs at wall-clock rate', () => {
    const sync: VideoSync = {
      videoName: 'q1.mp4', videoSize: 1,
      anchors: [
        { momentId: T, videoTime: 30, createdAt: 'x' },
        { momentId: T + 120_000, videoTime: 150, createdAt: 'x' },
      ],
    }
    const r = rows(buildSyncPointsCSV(sync, meta, frames))
    expect(r[1].cut_before_s).toBe('0')
  })

  it('leaves the clock blank for an anchor with no matching frame', () => {
    const sync: VideoSync = {
      videoName: 'q1.mp4', videoSize: 1,
      anchors: [{ momentId: T + 99_999_999, videoTime: 5, createdAt: 'x' }],
    }
    expect(rows(buildSyncPointsCSV(sync, meta, frames))[0].clock).toBe('')
  })
})
