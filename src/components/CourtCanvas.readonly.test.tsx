import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

/**
 * Konva draws to a real canvas context, which jsdom does not provide, so the
 * scene graph is mocked as plain elements. That is not just a workaround: it
 * forwards the click handlers to the DOM, which is what lets this file prove
 * the read-only guard actually blocks a write rather than merely hiding the UI.
 *
 * Why this matters: the review page borrows a quarter a real annotator loaded,
 * and the localStorage key comes from quarterMeta.filename. Without the guard,
 * one stray click on the court writes into that annotator's saved file.
 */
vi.mock('react-konva', () => {
  const passthrough = (name: string) =>
    ({ children, onClick, onDblClick, ...rest }: {
      children?: ReactNode
      onClick?: () => void
      onDblClick?: () => void
      [k: string]: unknown
    }) => (
      <div
        data-konva={name}
        data-player={typeof rest.key === 'string' ? rest.key : undefined}
        onClick={onClick}
        onDoubleClick={onDblClick}
      >{children}</div>
    )
  return {
    Stage: passthrough('Stage'),
    Layer: passthrough('Layer'),
    Group: passthrough('Group'),
    Circle: passthrough('Circle'),
    Text: passthrough('Text'),
    Arrow: passthrough('Arrow'),
    Image: passthrough('Image'),
  }
})

import type { Player } from '../store/useStore'

const { default: CourtCanvas } = await import('./CourtCanvas')
const { useStore } = await import('../store/useStore')

const TEAM_A = 100, TEAM_B = 200
const players: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
]

const meta = {
  filename: 'readonly_test', gameId: 'G1', quarter: 1,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: [players[0]] },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: [players[1]] },
  defendingTeamId: TEAM_A, totalFrames: 2, startClock: 400, endClock: 399.5,
}
const frames = [0, 1].map(i => ({
  frameIndex: i, momentId: 1000 + i, quarterClock: 400 - i * 0.5, shotClock: 24,
  ballX: 0, ballY: 0, ballZ: 0,
  players: players.map(p => ({ id: p.id, teamId: p.teamId, x: 10 + p.id, y: 10 })),
}))

const KEY = 'annotation_quarter_readonly_test'

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    frames, quarterMeta: { ...meta },
    playerDict: Object.fromEntries(players.map(p => [p.id, p])),
    cellAnnotations: [], deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
    currentFrame: 0, flipX: false, flipY: false,
  })
})

/** Click the defender then the attacker — the normal assign gesture. */
async function attemptAssign() {
  const groups = document.querySelectorAll('[data-konva="Group"]')
  if (groups.length >= 2) {
    await userEvent.click(groups[0] as HTMLElement)
    await userEvent.click(groups[1] as HTMLElement)
  }
  return groups.length
}

describe('CourtCanvas readOnly', () => {
  it('blocks the assign gesture that succeeds when editable', async () => {
    // Baseline: the same gesture writes an annotation in normal mode.
    const editable = render(<CourtCanvas />)
    expect(await attemptAssign()).toBeGreaterThan(0)
    const wroteWhenEditable = useStore.getState().cellAnnotations.length
    editable.unmount()

    useStore.setState({ cellAnnotations: [] })
    render(<CourtCanvas readOnly />)
    await attemptAssign()

    expect(wroteWhenEditable).toBeGreaterThan(0)          // the gesture is real
    expect(useStore.getState().cellAnnotations).toHaveLength(0)   // and blocked
  })

  it("leaves the annotator's saved file byte-identical", async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'x', defenderId: 1, attackerId: 6, shotClockBucket: 400 }]))
    const before = localStorage.getItem(KEY)

    render(<CourtCanvas readOnly />)
    await attemptAssign()

    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('hides the editing hint', async () => {
    render(<CourtCanvas readOnly />)
    await attemptAssign()
    expect(screen.queryByText(/Click attacker to assign/)).not.toBeInTheDocument()
  })

  it('shows the editing hint when NOT read-only, so the flag cannot default on', async () => {
    render(<CourtCanvas />)
    const groups = document.querySelectorAll('[data-konva="Group"]')
    await userEvent.click(groups[0] as HTMLElement)     // select the defender
    expect(screen.getByText(/Click attacker to assign/)).toBeInTheDocument()
  })
})
