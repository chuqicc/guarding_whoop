import { describe, it, expect } from 'vitest'
import { buildAnnotationExport, buildFrameCSV, type ExportInput } from './export'
import { parseAnnotationJSON } from './importJSON'
import type { CellAnnotation, TrackingFrame, PossessionMeta, Player } from '../store/useStore'

const TEAM_A = 100
const TEAM_B = 200

const playersA: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 2, name: 'Def Two', jersey: '5', teamId: TEAM_A, teamAbbr: 'AAA' },
]
const playersB: Player[] = [
  { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
  { id: 7, name: 'Att Two', jersey: '11', teamId: TEAM_B, teamAbbr: 'BBB' },
]
const playerDict: Record<number, Player> = Object.fromEntries(
  [...playersA, ...playersB].map(p => [p.id, p])
)

const meta: PossessionMeta = {
  filename: 'test_poss', gameId: 'G1', quarter: 2, possessionIndex: 3,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A,
  totalFrames: 6, startClock: 400, endClock: 398,
}

const onCourt = [...playersA, ...playersB].map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 }))

function frame(frameIndex: number, quarterClock: number, shotClock: number, momentId?: number): TrackingFrame {
  return { frameIndex, momentId, quarterClock, shotClock, ballX: 0, ballY: 0, ballZ: 0, players: onCourt }
}

// Three buckets: 24 (frames 0-1), 23 (frames 2-3, dead), 22 (frames 4-5)
const frames: TrackingFrame[] = [
  frame(0, 400.0, 24.8, 1000), frame(1, 399.9, 24.1, 1040),
  frame(2, 399.8, 23.9, 1080), frame(3, 399.7, 23.2, 1120),
  frame(4, 399.6, 22.9, 1160), frame(5, 399.5, 22.1, 1200),
]

const annotations: CellAnnotation[] = [
  { id: 'a1', defenderId: 1, attackerId: 6,            shotClockBucket: 24, confidence: 2 },
  { id: 'a2', defenderId: 2, attackerId: 'GUARD_NONE', shotClockBucket: 24 },
  { id: 'a3', defenderId: 1, attackerId: 7,            shotClockBucket: 23 },  // in dead bucket → must not export
  { id: 'a4', defenderId: 1, attackerId: 7,            shotClockBucket: 22, confidence: 3 },
]

const input: ExportInput = {
  annotations,
  deadTimeBuckets: [23],
  shotBuckets: [22],
  reboundBuckets: [22, 23],
  frames, meta, playerDict,
  annotatorName: 'tester',
  annotationSeconds: 120,
  notes: [],
}

describe('buildAnnotationExport (JSON v2)', () => {
  const out = buildAnnotationExport(input)

  it('has v2 format marker and meta', () => {
    expect(out.format).toBe('guard-annotation/v2')
    expect(out.meta.game_id).toBe('G1')
    expect(out.meta.mode).toBe('possession')
    expect(out.meta.bucket_unit).toBe('shot_clock_s')
    expect(Object.keys(out.meta.players)).toHaveLength(4)
    expect(out.meta.players['1']).toEqual({ name: 'Def One', jersey: '4', team: 'AAA' })
  })

  it('aggregates one row per bucket, chronological', () => {
    expect(out.buckets.map(b => b.bucket)).toEqual([24, 23, 22])
    const b24 = out.buckets[0]
    expect(b24.frame_start).toBe(0)
    expect(b24.frame_end).toBe(1)
    expect(b24.moment_start).toBe(1000)
    expect(b24.moment_end).toBe(1040)
  })

  it('feature 1: dead bucket exports no assignments even though one was recorded', () => {
    const b23 = out.buckets[1]
    expect(b23.status).toBe('dead')
    expect(b23.assignments).toBeUndefined()
    expect(b23.def_team).toBeUndefined()
  })

  it('feature 4: shot/rebound events land on the right buckets', () => {
    expect(out.buckets[0].events).toBeUndefined()          // 24: none
    expect(out.buckets[1].events).toEqual(['rebound'])     // 23
    expect(out.buckets[2].events).toEqual(['shot', 'rebound']) // 22
  })

  it('maps assignments: id, NONE, null(unannotated); conf omitted when 3', () => {
    const b24 = out.buckets[0]
    expect(b24.def_team).toBe('AAA')
    expect(b24.att_team).toBe('BBB')
    expect(b24.assignments).toEqual([
      { def: 1, att: 6, conf: 2 },
      { def: 2, att: 'NONE' },
    ])
    const b22 = out.buckets[2]
    expect(b22.assignments).toEqual([
      { def: 1, att: 7 },        // conf 3 → omitted
      { def: 2, att: null },     // never annotated
    ])
  })
})

describe('parseAnnotationJSON round-trip (v2)', () => {
  it('restores annotations, dead, shot and rebound buckets', () => {
    const out = buildAnnotationExport(input)
    const imported = parseAnnotationJSON(JSON.stringify(out), false)

    expect(imported.deadTimeBuckets).toEqual([23])
    expect(imported.shotBuckets).toEqual([22])
    expect(imported.reboundBuckets?.sort()).toEqual([22, 23])

    const byKey = new Map(imported.annotations.map(a => [`${a.defenderId}_${a.shotClockBucket}`, a]))
    expect(byKey.size).toBe(3)  // a3 (dead bucket) is gone by design
    expect(byKey.get('1_24')).toMatchObject({ attackerId: 6, confidence: 2 })
    expect(byKey.get('2_24')).toMatchObject({ attackerId: 'GUARD_NONE' })
    expect(byKey.get('1_22')).toMatchObject({ attackerId: 7 })
  })

  it('parses old v1 per-frame format', () => {
    const v1 = {
      metadata: { game_id: 'G1' },
      frames: [
        { frame: 0, quarter_clock: 400, shot_clock: 24.5, gamestatus: 'active',
          assignments: [ { defender_id: 1, attacker_id: 6, confidence: 2 },
                         { defender_id: 2, attacker_id: 'GUARD_NONE' },
                         { defender_id: 2, attacker_id: null } ] },
        { frame: 2, quarter_clock: 399.8, shot_clock: 23.5, gamestatus: 'dead', assignments: [] },
      ],
    }
    const imported = parseAnnotationJSON(JSON.stringify(v1), false)
    expect(imported.annotations).toHaveLength(2)
    expect(imported.deadTimeBuckets).toEqual([23])
  })

  it('parses legacy pairs format', () => {
    const legacy = { pairs: [ { defender_id: 1, attacker_id: 6, shot_clock_second: 20 },
                              { defender_id: 2, attacker_id: null, shot_clock_second: 19 } ] }
    const imported = parseAnnotationJSON(JSON.stringify(legacy), false)
    expect(imported.annotations).toHaveLength(2)
    expect(imported.annotations[1].attackerId).toBe('GUARD_NONE')
  })

  it('throws on unrecognized JSON', () => {
    expect(() => parseAnnotationJSON('{"foo": 1}', false)).toThrow()
  })
})

describe('buildFrameCSV', () => {
  const csv = buildFrameCSV(input)
  const lines = csv.split('\n')
  const headers = lines[0].split(',')

  it('feature 4: has is_shot / is_rebound columns', () => {
    expect(headers).toContain('is_shot')
    expect(headers).toContain('is_rebound')
  })

  it('every row has the same column count as the header', () => {
    for (const line of lines.slice(1)) {
      expect(line.split(',')).toHaveLength(headers.length)
    }
  })

  it('bucket-level event flags appear on every frame row of the bucket', () => {
    const iShot = headers.indexOf('is_shot')
    const iReb  = headers.indexOf('is_rebound')
    const iSc   = headers.indexOf('shot_clock')
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      const bucket = Math.floor(parseFloat(cols[iSc]))
      expect(cols[iShot]).toBe(bucket === 22 ? '1' : '0')
      expect(cols[iReb]).toBe(bucket === 22 || bucket === 23 ? '1' : '0')
    }
  })

  it('feature 1: dead frames export blank assignment fields', () => {
    const iStatus = headers.indexOf('gamestatus')
    const iDefId  = headers.indexOf('defender_id')
    const deadRows = lines.slice(1).filter(l => l.split(',')[iStatus] === 'dead')
    expect(deadRows.length).toBe(2 * 5)  // 2 dead frames × 5 placeholder rows
    for (const row of deadRows) {
      expect(row.split(',')[iDefId]).toBe('')
    }
  })
})
