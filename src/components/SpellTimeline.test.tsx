import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SpellTimeline from './SpellTimeline'
import { useStore } from '../store/useStore'
import type { QuarterMeta, Player, TrackingFrame, CellAnnotation } from '../store/useStore'

const TEAM_A = 100, TEAM_B = 200
const players: Player[] = [
  { id: 1, name: 'Def One', jersey: '23', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 6, name: 'Att One', jersey: '7',  teamId: TEAM_B, teamAbbr: 'BBB' },
  { id: 7, name: 'Att Two', jersey: '12', teamId: TEAM_B, teamAbbr: 'BBB' },
]
const playerDict = Object.fromEntries(players.map(p => [p.id, p]))

const meta: QuarterMeta = {
  filename: 'spell_view', gameId: 'G1', quarter: 1,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: [players[0]] },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: [players[1], players[2]] },
  defendingTeamId: TEAM_A, totalFrames: 6, startClock: 400, endClock: 398,
}

// six 0.5s buckets: 400.0 .. 397.5
const frames: TrackingFrame[] = [400.0, 399.5, 399.0, 398.5, 398.0, 397.5].map((qc, i) => ({
  frameIndex: i, momentId: 1000 + i, quarterClock: qc, shotClock: 24 - i,
  ballX: 0, ballY: 0, ballZ: 0,
  players: players.map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 })),
}))

let n = 0
const cell = (att: CellAnnotation['attackerId'], bucket: number): CellAnnotation =>
  ({ id: `c${n++}`, defenderId: 1, attackerId: att, shotClockBucket: bucket })

function load(cells: CellAnnotation[], over: Partial<Parameters<typeof useStore.setState>[0]> = {}) {
  useStore.setState({
    quarterMeta: { ...meta }, frames, playerDict,
    cellAnnotations: cells,
    deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
    memoryBarrierFrames: [], currentFrame: 0,
    ...over,
  })
}

beforeEach(() => { localStorage.clear(); n = 0 })

describe('SpellTimeline', () => {
  it('prompts for data when nothing is loaded', () => {
    useStore.setState({ quarterMeta: null, frames: [], cellAnnotations: [] })
    render(<SpellTimeline />)
    expect(screen.getByText(/Load tracking data/i)).toBeInTheDocument()
  })

  it('explains itself when a quarter is loaded but nothing is annotated', () => {
    load([])
    render(<SpellTimeline />)
    expect(screen.getByText(/No spells yet/i)).toBeInTheDocument()
  })

  it('shows three consecutive buckets as ONE 1.5s spell, not three cells', () => {
    load([cell(6, 400.0), cell(6, 399.5), cell(6, 399.0)])
    render(<SpellTimeline />)

    expect(screen.getByLabelText(/1\.5s marking Att One/)).toBeInTheDocument()
    // summary bar: one spell, 1.5s of marking in total
    expect(screen.getByLabelText('1 spells')).toBeInTheDocument()
    expect(screen.getByLabelText('1.5s total marked')).toBeInTheDocument()
  })

  it('splits a switch into two spells and reports the switch', () => {
    load([cell(6, 400.0), cell(6, 399.5), cell(7, 399.0), cell(7, 398.5)])
    render(<SpellTimeline />)

    expect(screen.getByLabelText(/1\.0s marking Att One.*ended: switched/)).toBeInTheDocument()
    expect(screen.getByLabelText(/1\.0s marking Att Two/)).toBeInTheDocument()
  })

  it('labels a GUARD_NONE spell as marking no one', () => {
    load([cell('GUARD_NONE', 400.0), cell('GUARD_NONE', 399.5)])
    render(<SpellTimeline />)
    expect(screen.getByLabelText(/marking no one/)).toBeInTheDocument()
  })

  it('breaks the spell at a dead ball and says so', () => {
    load([cell(6, 400.0), cell(6, 399.0)], { deadTimeBuckets: [399.5] })
    render(<SpellTimeline />)
    expect(screen.getByLabelText(/ended: dead ball/)).toBeInTheDocument()
  })

  it('shows the defender once, with jersey and name', () => {
    load([cell(6, 400.0), cell(7, 399.0)])
    render(<SpellTimeline />)
    expect(screen.getAllByText('#23')).toHaveLength(1)
    expect(screen.getByText('Def One')).toBeInTheDocument()
  })
})
