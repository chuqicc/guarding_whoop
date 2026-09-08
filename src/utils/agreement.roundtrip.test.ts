import { describe, it, expect } from 'vitest'
import { buildAnnotationExport, buildFrameCSV, type ExportInput } from './export'
import { parseAnnotationDocument } from './annotationDocument'
import { computeAgreement } from './agreement'
import type { CellAnnotation, TrackingFrame, QuarterMeta, Player } from '../store/useStore'

/**
 * The strongest single check on the whole feature: one annotator's work,
 * exported both ways, compared against itself. Anything below 100% means the
 * JSON and CSV parse paths disagree, and every mixed-format comparison would
 * report format artefacts as real disagreements between people.
 */

const TEAM_A = 100, TEAM_B = 200
const playersA: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 2, name: 'Smith, Jr.', jersey: '5', teamId: TEAM_A, teamAbbr: 'AAA' },
]
const playersB: Player[] = [
  { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
  { id: 7, name: 'Att Two', jersey: '11', teamId: TEAM_B, teamAbbr: 'BBB' },
]
const playerDict: Record<number, Player> = Object.fromEntries(
  [...playersA, ...playersB].map(p => [p.id, p]),
)
const meta: QuarterMeta = {
  filename: 'rt', gameId: 'G1', quarter: 3,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A, totalFrames: 10, startClock: 400.2, endClock: 398.2,
}
const onCourt = [...playersA, ...playersB].map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 }))

// 5 buckets x 2 frames, one dead, with a switch part-way through
const frames: TrackingFrame[] = [
  400.2, 400.0, 399.8, 399.6, 399.4, 399.2, 399.0, 398.8, 398.6, 398.4,
].map((qc, i) => ({
  frameIndex: i, momentId: 1000 + i * 40, quarterClock: qc, shotClock: 24 - i * 0.4,
  ballX: 0, ballY: 0, ballZ: 0, players: onCourt,
}))

const annotations: CellAnnotation[] = [
  { id: 'x1', defenderId: 1, attackerId: 6, shotClockBucket: 400.0, confidence: 2 },
  { id: 'x2', defenderId: 2, attackerId: 'GUARD_NONE', shotClockBucket: 400.0 },
  { id: 'x3', defenderId: 1, attackerId: 6, shotClockBucket: 399.5 },
  { id: 'x4', defenderId: 1, attackerId: 7, shotClockBucket: 399.0 },   // switch
  { id: 'x5', defenderId: 2, attackerId: 6, shotClockBucket: 399.0 },
  { id: 'x6', defenderId: 1, attackerId: 7, shotClockBucket: 398.5 },
]

const input: ExportInput = {
  annotations,
  deadTimeBuckets: [398.0],
  shotBuckets: [399.0],
  reboundBuckets: [],
  frames, meta, playerDict,
  annotatorName: 'Alice', annotationSeconds: 300, notes: [],
}

describe('the same work exported both ways compares as identical', () => {
  const json = parseAnnotationDocument(JSON.stringify(buildAnnotationExport(input)), 'a.json')
  const csv = parseAnnotationDocument(buildFrameCSV(input), 'a.csv')
  const report = computeAgreement(json, csv)

  it('agrees on every compared cell', () => {
    expect(report.nDisagree).toBe(0)
    expect(report.rawAgreement).toBe(1)
    expect(report.nCompared).toBeGreaterThan(0)
  })

  it('finds no coverage gaps between the formats', () => {
    expect(report.nCoverageMismatch).toBe(0)
  })

  it('finds no defending-team disagreement between the formats', () => {
    expect(report.nDefenseMismatch).toBe(0)
  })

  it('extracts the same switch events from both', () => {
    expect(report.switchEvents.nA).toBe(report.switchEvents.nB)
    expect(report.switchEvents.nA).toBeGreaterThan(0)
    expect(report.switchEvents.f1).toBe(1)
    expect(report.switchEvents.medianOffsetBuckets).toBe(0)
  })

  it('agrees on which buckets were dead', () => {
    expect(report.deadLive.agreement).toBe(1)
  })

  it('holds even with a comma in a player name', () => {
    // Defender 2 is "Smith, Jr." — the case that used to shift CSV columns.
    expect(report.perDefender.find(d => d.defenderId === 2)?.rawAgreement).toBe(1)
  })
})
