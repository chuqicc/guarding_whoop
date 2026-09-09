import { describe, it, expect } from 'vitest'
import { parseAnnotationCSV } from './importCSV'
import { buildFrameCSV, type ExportInput } from './export'
import type { CellAnnotation, TrackingFrame, QuarterMeta, Player } from '../store/useStore'

const TEAM_A = 100, TEAM_B = 200
const playersA: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 2, name: 'Def Two', jersey: '5', teamId: TEAM_A, teamAbbr: 'AAA' },
]
const playersB: Player[] = [
  { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
  { id: 7, name: 'Att Two', jersey: '11', teamId: TEAM_B, teamAbbr: 'BBB' },
]
const playerDict: Record<number, Player> = Object.fromEntries(
  [...playersA, ...playersB].map(p => [p.id, p]),
)
const meta: QuarterMeta = {
  filename: 'imp', gameId: 'G1', quarter: 2,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A, totalFrames: 6, startClock: 400.2, endClock: 399.2,
}
const onCourt = [...playersA, ...playersB].map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 }))
const frame = (i: number, qc: number, sc: number, mid: number): TrackingFrame =>
  ({ frameIndex: i, momentId: mid, quarterClock: qc, shotClock: sc, ballX: 0, ballY: 0, ballZ: 0, players: onCourt })

// buckets 400.0 (frames 0-1), 399.5 (frames 2-3, dead), 399.0 (frames 4-5)
const frames: TrackingFrame[] = [
  frame(0, 400.2, 24.8, 1000), frame(1, 400.0, 24.1, 1040),
  frame(2, 399.8, 23.9, 1080), frame(3, 399.6, 23.2, 1120),
  frame(4, 399.4, 22.9, 1160), frame(5, 399.2, 22.1, 1200),
]
const annotations: CellAnnotation[] = [
  { id: 'a1', defenderId: 1, attackerId: 6,            shotClockBucket: 400.0, confidence: 2 },
  { id: 'a2', defenderId: 2, attackerId: 'GUARD_NONE', shotClockBucket: 400.0 },
  { id: 'a3', defenderId: 1, attackerId: 7,            shotClockBucket: 399.0 },
]
const input: ExportInput = {
  annotations,
  deadTimeBuckets: [399.5],
  shotBuckets: [399.0],
  reboundBuckets: [399.0, 399.5],
  frames, meta, playerDict,
  annotatorName: 'Alice', annotationSeconds: 60, notes: [],
}

/** Reproduce the pre-fix export, where dead frames were blank placeholder rows. */
function oldStyleCSV(): string {
  const lines = buildFrameCSV(input).split('\n')
  const headers = lines[0].split(',')
  const iStatus = headers.indexOf('gamestatus')
  const out = [lines[0]]
  const seenDeadFrames = new Set<string>()
  for (const line of lines.slice(1)) {
    const c = line.split(',')
    if (c[iStatus] !== 'dead') { out.push(line); continue }
    // one blank-assignment row per dead frame, as the old exporter wrote
    const frameKey = c[2]
    if (seenDeadFrames.has(frameKey)) continue
    seenDeadFrames.add(frameKey)
    for (let i = 5; i <= 13; i++) c[i] = ''
    out.push(c.join(','))
  }
  return out.join('\n')
}

describe('parseAnnotationCSV restores everything the file contains', () => {
  it('brings back dead / shot / rebound, not just the assignments', () => {
    const r = parseAnnotationCSV(buildFrameCSV(input))
    expect(r.deadTimeBuckets).toEqual([399.5])
    expect(r.shotBuckets).toEqual([399.0])
    expect(r.reboundBuckets?.slice().sort()).toEqual([399.0, 399.5])
  })

  it('still restores the assignments', () => {
    const r = parseAnnotationCSV(buildFrameCSV(input))
    const byKey = new Map(r.annotations.map(a => [`${a.defenderId}_${a.shotClockBucket}`, a]))
    expect(byKey.get('1_400')).toMatchObject({ attackerId: 6, confidence: 2 })
    expect(byKey.get('2_400')).toMatchObject({ attackerId: 'GUARD_NONE' })
    expect(byKey.get('1_399')).toMatchObject({ attackerId: 7 })
  })

  it('reads the flags from an OLD export whose dead rows were blank', () => {
    // This is the reported bug: importing a CSV from a previous version left
    // the Dead / Shot / Rebound rows empty in the grid.
    const r = parseAnnotationCSV(oldStyleCSV())
    expect(r.deadTimeBuckets).toEqual([399.5])
    expect(r.shotBuckets).toEqual([399.0])
    expect(r.reboundBuckets?.slice().sort()).toEqual([399.0, 399.5])
    // and the live assignments are unaffected
    expect(r.annotations.length).toBe(3)
  })

  it('survives a comma in a player name', () => {
    const dict = { ...playerDict, 1: { ...playerDict[1], name: 'Smith, Jr.' } }
    const m = { ...meta, teamA: { ...meta.teamA, players: [{ ...playersA[0], name: 'Smith, Jr.' }, playersA[1]] } }
    const r = parseAnnotationCSV(buildFrameCSV({ ...input, playerDict: dict, meta: m }))
    expect(r.annotations.find(a => a.defenderId === 1 && a.shotClockBucket === 400)?.attackerId).toBe(6)
  })

  it('survives CRLF line endings', () => {
    const r = parseAnnotationCSV(buildFrameCSV(input).replace(/\n/g, '\r\n'))
    expect(r.deadTimeBuckets).toEqual([399.5])
    expect(r.annotations.length).toBe(3)
  })
})
