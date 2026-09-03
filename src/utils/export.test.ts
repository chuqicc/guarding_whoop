import { describe, it, expect } from 'vitest'
import { buildAnnotationExport, buildFrameCSV, type ExportInput } from './export'
import { parseAnnotationJSON } from './importJSON'
import type { CellAnnotation, TrackingFrame, QuarterMeta, Player } from '../store/useStore'

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

const meta: QuarterMeta = {
  filename: 'test_quarter', gameId: 'G1', quarter: 2,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A,
  totalFrames: 6, startClock: 400.2, endClock: 399.2,
}

const onCourt = [...playersA, ...playersB].map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 }))

function frame(frameIndex: number, quarterClock: number, shotClock: number, momentId?: number): TrackingFrame {
  return { frameIndex, momentId, quarterClock, shotClock, ballX: 0, ballY: 0, ballZ: 0, players: onCourt }
}

// Three 0.5s quarter-clock buckets:
//   400.0 (frames 0-1), 399.5 (frames 2-3, dead), 399.0 (frames 4-5)
const frames: TrackingFrame[] = [
  frame(0, 400.2, 24.8, 1000), frame(1, 400.0, 24.1, 1040),
  frame(2, 399.8, 23.9, 1080), frame(3, 399.6, 23.2, 1120),
  frame(4, 399.4, 22.9, 1160), frame(5, 399.2, 22.1, 1200),
]

const annotations: CellAnnotation[] = [
  { id: 'a1', defenderId: 1, attackerId: 6,            shotClockBucket: 400.0, confidence: 2 },
  { id: 'a2', defenderId: 2, attackerId: 'GUARD_NONE', shotClockBucket: 400.0 },
  { id: 'a3', defenderId: 1, attackerId: 7,            shotClockBucket: 399.5 },  // in dead bucket → must not export
  { id: 'a4', defenderId: 1, attackerId: 7,            shotClockBucket: 399.0, confidence: 3 },
]

const input: ExportInput = {
  annotations,
  deadTimeBuckets: [399.5],
  shotBuckets: [399.0],
  reboundBuckets: [399.0, 399.5],
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
    expect(out.meta.mode).toBe('quarter')
    expect(out.meta.bucket_unit).toBe('quarter_clock_0.5s')
    expect(Object.keys(out.meta.players)).toHaveLength(4)
    expect(out.meta.players['1']).toEqual({ name: 'Def One', jersey: '4', team: 'AAA' })
  })

  it('aggregates one row per bucket, chronological', () => {
    expect(out.buckets.map(b => b.bucket)).toEqual([400.0, 399.5, 399.0])
    const first = out.buckets[0]
    expect(first.frame_start).toBe(0)
    expect(first.frame_end).toBe(1)
    expect(first.moment_start).toBe(1000)
    expect(first.moment_end).toBe(1040)
  })

  it('feature 1: a dead bucket is marked dead but keeps what was recorded', () => {
    // Previously this dropped `assignments` entirely. Marking a bucket dead is
    // a statement about the game clock, not permission to delete an
    // annotator's work — downstream analysis filters on `status` instead.
    const dead = out.buckets[1]
    expect(dead.status).toBe('dead')
    expect(dead.def_team).toBe('AAA')
    expect(dead.assignments?.find(a => a.def === 1)?.att).toBe(7)
  })

  it('feature 4: shot/rebound events land on the right buckets', () => {
    expect(out.buckets[0].events).toBeUndefined()               // 400.0: none
    expect(out.buckets[1].events).toEqual(['rebound'])          // 399.5
    expect(out.buckets[2].events).toEqual(['shot', 'rebound'])  // 399.0
  })

  it('maps assignments: id, NONE, null(unannotated); conf omitted when 3', () => {
    const first = out.buckets[0]
    expect(first.def_team).toBe('AAA')
    expect(first.att_team).toBe('BBB')
    expect(first.assignments).toEqual([
      { def: 1, att: 6, conf: 2 },
      { def: 2, att: 'NONE' },
    ])
    const last = out.buckets[2]
    expect(last.assignments).toEqual([
      { def: 1, att: 7 },        // conf 3 → omitted
      { def: 2, att: null },     // never annotated
    ])
  })
})

describe('parseAnnotationJSON round-trip (v2)', () => {
  it('restores annotations, dead, shot and rebound buckets', () => {
    const out = buildAnnotationExport(input)
    const imported = parseAnnotationJSON(JSON.stringify(out))

    expect(imported.deadTimeBuckets).toEqual([399.5])
    expect(imported.shotBuckets).toEqual([399.0])
    expect(imported.reboundBuckets?.sort()).toEqual([399.0, 399.5])

    const byKey = new Map(imported.annotations.map(a => [`${a.defenderId}_${a.shotClockBucket}`, a]))
    expect(byKey.size).toBe(4)  // all four survive, including the dead-bucket one
    expect(byKey.get('1_400')).toMatchObject({ attackerId: 6, confidence: 2 })
    expect(byKey.get('2_400')).toMatchObject({ attackerId: 'GUARD_NONE' })
    expect(byKey.get('1_399.5')).toMatchObject({ attackerId: 7 })
    expect(byKey.get('1_399')).toMatchObject({ attackerId: 7 })
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
    const imported = parseAnnotationJSON(JSON.stringify(v1))
    expect(imported.annotations).toHaveLength(2)
    expect(imported.deadTimeBuckets).toEqual([399.5])
  })

  it('parses legacy pairs format', () => {
    const legacy = { pairs: [ { defender_id: 1, attacker_id: 6, shot_clock_second: 20 },
                              { defender_id: 2, attacker_id: null, shot_clock_second: 19 } ] }
    const imported = parseAnnotationJSON(JSON.stringify(legacy))
    expect(imported.annotations).toHaveLength(2)
    expect(imported.annotations[1].attackerId).toBe('GUARD_NONE')
  })

  it('throws on unrecognized JSON', () => {
    expect(() => parseAnnotationJSON('{"foo": 1}')).toThrow()
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
    const iQc   = headers.indexOf('quarter_clock')
    for (const line of lines.slice(1)) {
      const cols = line.split(',')
      const bucket = Math.floor(parseFloat(cols[iQc]) / 0.5) * 0.5
      expect(cols[iShot]).toBe(bucket === 399.0 ? '1' : '0')
      expect(cols[iReb]).toBe(bucket === 399.0 || bucket === 399.5 ? '1' : '0')
    }
  })

  it('feature 1: dead frames are flagged dead but still carry their defenders', () => {
    const iStatus = headers.indexOf('gamestatus')
    const iDefId  = headers.indexOf('defender_id')
    const deadRows = lines.slice(1).filter(l => l.split(',')[iStatus] === 'dead')
    // 2 dead frames × 2 on-court defenders on the defending team
    expect(deadRows.length).toBe(2 * 2)
    for (const row of deadRows) {
      expect(row.split(',')[iDefId]).not.toBe('')
    }
  })
})

// ── Regressions for the three export data-loss paths ────────────────────────
//
// Each of these silently dropped annotations that the UI had accepted, stored
// in localStorage, and displayed back to the annotator. They are correctness
// bugs in a research artifact, not cosmetic ones.

describe('export preserves every recorded annotation', () => {
  it('keeps assignments for the team that was NOT derived as defending', () => {
    // AnnotationArea renders "historical" rows for the other team after a
    // defense swap, and those cells persist. They must reach the export.
    const mixed: CellAnnotation[] = [
      { id: 'x1', defenderId: 1, attackerId: 6, shotClockBucket: 400.0 },  // team A defends
      { id: 'x2', defenderId: 6, attackerId: 1, shotClockBucket: 400.0 },  // team B defender, same bucket
    ]
    const out = buildAnnotationExport({ ...input, annotations: mixed, deadTimeBuckets: [] })
    const first = out.buckets[0]
    const defs = (first.assignments ?? []).map(a => a.def)
    expect(defs).toContain(1)
    expect(defs).toContain(6)
  })

  it('keeps a defender who is only on court later in the bucket (substitution)', () => {
    // onCourtIds was built from the bucket's FIRST frame only, so a player
    // subbed in mid-bucket lost their annotation.
    const sub = { id: 9, name: 'Sub', jersey: '99', teamId: TEAM_A, teamAbbr: 'AAA' }
    const dictWithSub = { ...playerDict, 9: sub }
    const metaWithSub = {
      ...meta,
      teamA: { ...meta.teamA, players: [...playersA, sub] },
    }
    // frame 0 without the sub, frame 1 with them
    const subFrames: TrackingFrame[] = [
      { frameIndex: 0, momentId: 1000, quarterClock: 400.2, shotClock: 24.8,
        ballX: 0, ballY: 0, ballZ: 0, players: onCourt },
      { frameIndex: 1, momentId: 1040, quarterClock: 400.0, shotClock: 24.1,
        ballX: 0, ballY: 0, ballZ: 0, players: [...onCourt, { id: 9, teamId: TEAM_A, x: 0, y: 0 }] },
    ]
    const out = buildAnnotationExport({
      ...input,
      meta: metaWithSub,
      playerDict: dictWithSub,
      frames: subFrames,
      annotations: [{ id: 's1', defenderId: 9, attackerId: 6, shotClockBucket: 400.0 }],
      deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
    })
    const defs = (out.buckets[0].assignments ?? []).map(a => a.def)
    expect(defs).toContain(9)
  })

  it('still reports assignments recorded in a bucket later marked dead', () => {
    // Marking a bucket dead after annotating it silently deleted that work on
    // export. The bucket stays status:'dead'; the data must survive.
    const out = buildAnnotationExport(input)
    const dead = out.buckets[1]
    expect(dead.status).toBe('dead')
    const entry = (dead.assignments ?? []).find(a => a.def === 1)
    expect(entry?.att).toBe(7)
  })

  it('exports exactly as many annotated cells as were recorded', () => {
    const out = buildAnnotationExport(input)
    const exported = out.buckets.flatMap(b => b.assignments ?? []).filter(a => a.att !== null)
    expect(exported).toHaveLength(annotations.length)
  })
})

describe('CSV escaping', () => {
  it('does not corrupt a row when a player name contains a comma', () => {
    const commaDict: Record<number, Player> = {
      ...playerDict,
      1: { ...playerDict[1], name: 'Smith, Jr.' },
    }
    const commaMeta = {
      ...meta,
      teamA: { ...meta.teamA, players: [{ ...playersA[0], name: 'Smith, Jr.' }, playersA[1]] },
    }
    const csv = buildFrameCSV({ ...input, playerDict: commaDict, meta: commaMeta })
    const lines = csv.split('\n')
    const headerCount = lines[0].split(',').length
    for (const line of lines.slice(1)) {
      expect(splitCSVLine(line)).toHaveLength(headerCount)
    }
    expect(csv).toContain('"Smith, Jr."')
  })
})

// Minimal RFC4180-ish splitter, used only to assert the export is parseable.
function splitCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}
