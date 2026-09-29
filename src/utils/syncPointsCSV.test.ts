import { describe, it, expect } from 'vitest'
import { buildSyncPointsCSV } from './export'
import type { VideoSync } from './videoSync'
import { parseSyncPointsCSV } from './videoSync'
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

describe('sync points CSV — reading it back', () => {
  const sync: VideoSync = {
    videoName: 'q1.mp4', videoSize: 1,
    anchors: [
      { momentId: T, videoTime: 30, createdAt: '2026-01-01T00:00:00.000Z' },
      { momentId: T + 120_000, videoTime: 90, createdAt: '2026-01-01T00:05:00.000Z' },
    ],
  }

  it('round-trips every anchor — the point of exporting them', () => {
    const back = parseSyncPointsCSV(buildSyncPointsCSV(sync, meta, frames))
    expect(back.anchors.map(a => [a.momentId, a.videoTime]))
      .toEqual([[T, 30], [T + 120_000, 90]])
    expect(back.videoName).toBe('q1.mp4')
    expect(back.skipped).toBe(0)
  })

  it('survives a value that the display column would have rounded', () => {
    const odd: VideoSync = { ...sync, anchors: [{ momentId: T, videoTime: 30.04, createdAt: 'x' }] }
    // `video_time` renders as 0:30.0; `video_seconds` is the column that keeps it.
    expect(parseSyncPointsCSV(buildSyncPointsCSV(odd, meta, frames)).anchors[0].videoTime)
      .toBeCloseTo(30.04, 3)
  })

  it('falls back to the readable column when video_seconds is absent', () => {
    const csv = 'moment_id,video_time\n' + `${T},2:05.5`
    expect(parseSyncPointsCSV(csv).anchors).toEqual([
      expect.objectContaining({ momentId: T, videoTime: 125.5 }),
    ])
  })

  it('ignores the derived columns, so a hand-edited file still loads', () => {
    const csv = 'moment_id,video_seconds,clip_offset_s,cut_before_s\n'
      + `${T},30,nonsense,also nonsense`
    expect(parseSyncPointsCSV(csv).anchors).toHaveLength(1)
  })

  it('sorts what it reads, however the rows were ordered', () => {
    const csv = `moment_id,video_seconds\n${T + 500},9\n${T},1`
    expect(parseSyncPointsCSV(csv).anchors.map(a => a.momentId)).toEqual([T, T + 500])
  })

  it('counts unreadable rows instead of dropping them silently', () => {
    const csv = `moment_id,video_seconds\n${T},30\nnot-a-number,5\n${T + 1},\n`
    const out = parseSyncPointsCSV(csv)
    expect(out.anchors).toHaveLength(1)
    expect(out.skipped).toBe(2)
  })

  it('keeps the first of two rows on the same moment', () => {
    const csv = `moment_id,video_seconds\n${T},30\n${T},99`
    const out = parseSyncPointsCSV(csv)
    expect(out.anchors).toHaveLength(1)
    expect(out.anchors[0].videoTime).toBe(30)
    expect(out.skipped).toBe(1)
  })

  it('handles a quoted filename containing a comma', () => {
    const csv = 'moment_id,video_seconds,video_file\n' + `${T},30,"LAL vs MIN, Q1.mp4"`
    expect(parseSyncPointsCSV(csv).videoName).toBe('LAL vs MIN, Q1.mp4')
  })

  it('tolerates CRLF and a byte-order mark', () => {
    const csv = `\uFEFFmoment_id,video_seconds\r\n${T},30\r\n`
    expect(parseSyncPointsCSV(csv).anchors).toHaveLength(1)
  })

  it('reads nothing from a header it does not recognise', () => {
    const out = parseSyncPointsCSV('a,b\n1,2')
    expect(out.anchors).toEqual([])
    expect(out.skipped).toBe(1)
  })

  it('reads nothing from an empty file', () => {
    expect(parseSyncPointsCSV('')).toEqual({ anchors: [], videoName: '', skipped: 0 })
  })
})
