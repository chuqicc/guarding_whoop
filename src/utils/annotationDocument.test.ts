import { describe, it, expect } from 'vitest'
import { parseAnnotationDocument, UnsupportedAnnotationFile } from './annotationDocument'
import { buildAnnotationExport, buildFrameCSV, type ExportInput } from './export'
import type { CellAnnotation, TrackingFrame, QuarterMeta, Player } from '../store/useStore'

// ── A small real quarter, exported both ways ───────────────────────────────
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
  filename: 'doc_test', gameId: 'G1', quarter: 2,
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
  { id: 'a3', defenderId: 1, attackerId: 7,            shotClockBucket: 399.5 },
  { id: 'a4', defenderId: 1, attackerId: 7,            shotClockBucket: 399.0, confidence: 3 },
]
const input: ExportInput = {
  annotations, deadTimeBuckets: [399.5], shotBuckets: [399.0], reboundBuckets: [399.0],
  frames, meta, playerDict, annotatorName: 'Alice', annotationSeconds: 120, notes: [],
}

const asJSON = () => JSON.stringify(buildAnnotationExport(input))
const asCSV  = () => buildFrameCSV(input)

describe('parseAnnotationDocument — JSON', () => {
  const doc = parseAnnotationDocument(asJSON(), 'a.json')

  it('keeps the identity fields the resume-path importer throws away', () => {
    expect(doc.sourceFormat).toBe('json')
    expect(doc.annotator).toBe('Alice')
    expect(doc.gameId).toBe('G1')
    expect(doc.quarter).toBe(2)
  })

  it('keeps the defending team, needed to spot possession-level disagreement', () => {
    expect(doc.buckets.get(400.0)?.defTeam).toBe('AAA')
  })

  it('keeps rosters and frame extents', () => {
    expect(doc.players[1]).toMatchObject({ name: 'Def One', jersey: '4' })
    expect(doc.buckets.get(400.0)?.frameStart).toBe(0)
  })

  it('reads assignments including GUARD_NONE and confidence', () => {
    const b = doc.buckets.get(400.0)!
    expect(b.assignments.get(1)).toBe(6)
    expect(b.assignments.get(2)).toBe('GUARD_NONE')
    expect(b.confidence.get(1)).toBe(2)
  })

  it('marks the dead bucket while still keeping its data', () => {
    const dead = doc.buckets.get(399.5)!
    expect(dead.status).toBe('dead')
    expect(dead.assignments.get(1)).toBe(7)
  })

  it('rejects the old per-frame and legacy formats with an actionable message', () => {
    const v1 = JSON.stringify({ metadata: { game_id: 'G1' }, frames: [] })
    expect(() => parseAnnotationDocument(v1)).toThrow(UnsupportedAnnotationFile)
    expect(() => parseAnnotationDocument(v1)).toThrow(/Re-export/i)
    expect(() => parseAnnotationDocument(JSON.stringify({ pairs: [] }))).toThrow(UnsupportedAnnotationFile)
  })
})

describe('parseAnnotationDocument — CSV', () => {
  const doc = parseAnnotationDocument(asCSV(), 'a.csv')

  it('detects the format from content, not the filename', () => {
    expect(doc.sourceFormat).toBe('csv')
  })

  it('recovers the annotator, game and quarter from the columns', () => {
    expect(doc.annotator).toBe('Alice')
    expect(doc.gameId).toBe('G1')
    expect(doc.quarter).toBe(2)
  })

  it('collapses the per-frame rows into buckets, keeping the earliest frame', () => {
    // two frames per bucket in this fixture
    expect(doc.buckets.get(400.0)?.frameStart).toBe(0)
    expect(doc.buckets.get(399.0)?.frameStart).toBe(4)
  })

  it('carries the defending team through', () => {
    expect(doc.buckets.get(400.0)?.defTeam).toBe('AAA')
  })

  it('marks dead buckets', () => {
    expect(doc.buckets.get(399.5)?.status).toBe('dead')
  })

  it('distinguishes "never annotated" from GUARD_NONE', () => {
    // Defender 2 is GUARD_NONE at 400.0 but has no annotation at all at 399.0.
    // Collapsing those two would turn missing work into a real answer.
    expect(doc.buckets.get(400.0)!.assignments.get(2)).toBe('GUARD_NONE')
    expect(doc.buckets.get(399.0)!.assignments.has(2)).toBe(false)
  })

  it('rejects a CSV without the columns comparison needs', () => {
    expect(() => parseAnnotationDocument('game_id,quarter\nG1,2\n'))
      .toThrow(UnsupportedAnnotationFile)
  })
})

describe('CSV parsing regressions that would corrupt an agreement number', () => {
  it('survives a player name containing a comma', () => {
    const commaDict = { ...playerDict, 1: { ...playerDict[1], name: 'Smith, Jr.' } }
    const commaMeta = {
      ...meta,
      teamA: { ...meta.teamA, players: [{ ...playersA[0], name: 'Smith, Jr.' }, playersA[1]] },
    }
    const csv = buildFrameCSV({ ...input, playerDict: commaDict, meta: commaMeta })
    const doc = parseAnnotationDocument(csv, 'a.csv')

    // If the columns had shifted, the attacker id would be garbage.
    expect(doc.buckets.get(400.0)!.assignments.get(1)).toBe(6)
    expect(doc.players[1].name).toBe('Smith, Jr.')
    expect(doc.annotator).toBe('Alice')
  })

  it('survives CRLF line endings — annotator is the last column and the join key', () => {
    const doc = parseAnnotationDocument(asCSV().replace(/\n/g, '\r\n'), 'a.csv')
    expect(doc.annotator).toBe('Alice')
  })

  it('loads an older CSV whose dead frames were blank placeholder rows', () => {
    const lines = asCSV().split('\n')
    const headers = lines[0].split(',')
    const iStatus = headers.indexOf('gamestatus')
    const blanked = [
      lines[0],
      ...lines.slice(1).map(l => {
        const c = l.split(',')
        if (c[iStatus] !== 'dead') return l
        // blank out every assignment column, as the pre-fix export did
        for (let i = 5; i <= 13; i++) c[i] = ''
        return c.join(',')
      }),
    ].join('\n')

    const doc = parseAnnotationDocument(blanked, 'old.csv')
    expect(doc.buckets.get(399.5)?.status).toBe('dead')
    expect(doc.buckets.get(399.5)?.assignments.size).toBe(0)
    expect(doc.buckets.get(400.0)?.assignments.get(1)).toBe(6)   // live data intact
  })
})

describe('JSON and CSV normalise to the same thing', () => {
  // This is what makes mixing formats trustworthy: if the two parse paths
  // drift, comparing one annotator's JSON against another's CSV silently
  // reports disagreements that are really just format artefacts.
  it('produces identical assignments from both exports of the same work', () => {
    const j = parseAnnotationDocument(asJSON(), 'a.json')
    const c = parseAnnotationDocument(asCSV(), 'a.csv')

    expect([...c.buckets.keys()].sort()).toEqual([...j.buckets.keys()].sort())

    for (const bucket of j.buckets.keys()) {
      const jb = j.buckets.get(bucket)!
      const cb = c.buckets.get(bucket)!
      expect({ bucket, status: cb.status }).toEqual({ bucket, status: jb.status })
      expect({ bucket, defTeam: cb.defTeam }).toEqual({ bucket, defTeam: jb.defTeam })
      expect({ bucket, frameStart: cb.frameStart }).toEqual({ bucket, frameStart: jb.frameStart })
      expect({ bucket, a: [...cb.assignments.entries()].sort() })
        .toEqual({ bucket, a: [...jb.assignments.entries()].sort() })
    }
  })

  it('agrees on shot/rebound flags — both formats carry them', () => {
    const j = parseAnnotationDocument(asJSON(), 'a.json')
    const c = parseAnnotationDocument(asCSV(), 'a.csv')
    for (const bucket of j.buckets.keys()) {
      const jb = j.buckets.get(bucket)!
      const cb = c.buckets.get(bucket)!
      expect({ bucket, shot: cb.shot, rebound: cb.rebound })
        .toEqual({ bucket, shot: jb.shot, rebound: jb.rebound })
    }
    // the fixture marks 399.0 as both
    expect(j.buckets.get(399.0)).toMatchObject({ shot: true, rebound: true })
    expect(c.buckets.get(399.0)).toMatchObject({ shot: true, rebound: true })
  })

  it('agrees on the identity fields too', () => {
    const j = parseAnnotationDocument(asJSON(), 'a.json')
    const c = parseAnnotationDocument(asCSV(), 'a.csv')
    expect([c.annotator, c.gameId, c.quarter]).toEqual([j.annotator, j.gameId, j.quarter])
  })
})
