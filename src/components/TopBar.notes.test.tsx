import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('react-konva', () => {
  const p = (n: string) => ({ children }: { children?: ReactNode }) => <div data-konva={n}>{children}</div>
  return {
    Stage: p('Stage'), Layer: p('Layer'), Group: p('Group'),
    Circle: p('Circle'), Text: p('Text'), Arrow: p('Arrow'), Image: p('Image'),
  }
})

const { default: TopBar } = await import('./TopBar')
const { useStore } = await import('../store/useStore')
const { resetHistory } = await import('../store/undo')
import type { QuarterMeta, Player, TrackingFrame } from '../store/useStore'

const TEAM_A = 100, TEAM_B = 200
// Two defenders, so "did it stay on the last one?" is distinguishable from
// "did it reset?" — with a single defender both look the same.
const players: Player[] = [
  { id: 1, name: 'Bell', jersey: '23', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 2, name: 'Cruz', jersey: '5', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 6, name: 'Hall', jersey: '7', teamId: TEAM_B, teamAbbr: 'BBB' },
]
const meta: QuarterMeta = {
  filename: 'notes_test', gameId: 'G1', quarter: 1,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: [players[0], players[1]] },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: [players[2]] },
  defendingTeamId: TEAM_A, totalFrames: 2, startClock: 400, endClock: 399.5,
}
const frames: TrackingFrame[] = [0, 1].map(i => ({
  frameIndex: i, momentId: 1000 + i, quarterClock: 400 - i * 0.5, shotClock: 24,
  ballX: 0, ballY: 0, ballZ: 0,
  players: players.map(p => ({ id: p.id, teamId: p.teamId, x: 0, y: 0 })),
}))

beforeEach(() => {
  localStorage.clear()
  resetHistory()
  useStore.setState({
    frames, quarterMeta: { ...meta },
    playerDict: Object.fromEntries(players.map(p => [p.id, p])),
    currentFrame: 0, notes: [],
    cellAnnotations: [], deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
  })
})

const openNotes = async () => {
  await userEvent.click(screen.getByLabelText('Toggle notes'))
}

function seedNote(text = 'switch looked late here') {
  useStore.getState().addNote(400, text)
  resetHistory()   // so undo tests start from a known point
}

describe('notes popover — closing', () => {
  it('has a close button, which is what the ✕ now does', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    expect(screen.getByLabelText('Close notes')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Close notes'))
    expect(screen.queryByLabelText('Close notes')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Close notes')).not.toBeInTheDocument()
  })

  it('closes on a click outside', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await userEvent.click(document.body)
    expect(screen.queryByLabelText('Close notes')).not.toBeInTheDocument()
  })

  it('stays open when clicking inside it', async () => {
    seedNote()
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await userEvent.click(screen.getByText(/switch looked late/))
    expect(screen.getByLabelText('Close notes')).toBeInTheDocument()
  })
})

describe('notes popover — deleting', () => {
  it('does not label the delete control ✕, so it cannot be mistaken for close', async () => {
    seedNote()
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()

    const del = screen.getByLabelText(/Delete note/)
    expect(del.textContent).not.toBe('✕')
    // exactly one ✕ in the popover, and it closes
    expect(screen.getByLabelText('Close notes').textContent).toBe('✕')
  })

  it('still deletes when deliberately clicked', async () => {
    seedNote()
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await userEvent.click(screen.getByLabelText(/Delete note/))
    expect(useStore.getState().notes).toHaveLength(0)
  })

  it('can be undone — the part that made a mis-click costly', async () => {
    seedNote('irreplaceable observation')
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await userEvent.click(screen.getByLabelText(/Delete note/))
    expect(useStore.getState().notes).toHaveLength(0)

    useStore.getState().undo()
    expect(useStore.getState().notes).toHaveLength(1)
    expect(useStore.getState().notes[0].text).toBe('irreplaceable observation')
  })

  it('names the note in the undo label', () => {
    seedNote('boxed out early')
    const { removeNote, notes } = useStore.getState()
    removeNote(notes[0].id)
    expect(useStore.getState().undo()).toMatch(/boxed out early/)
  })

  it('persists the deletion, and the undo of it', () => {
    seedNote('temp')
    const key = 'notes_quarter_notes_test'
    useStore.getState().removeNote(useStore.getState().notes[0].id)
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(0)

    useStore.getState().undo()
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1)
  })
})

describe('notes popover — defender attribution', () => {
  const noteBox = () => screen.getByPlaceholderText(/Note at bucket/)
  const defenderSelect = () => screen.getByRole('combobox')

  const submit = async (text: string, defender?: string) => {
    await userEvent.type(noteBox(), text)
    if (defender) await userEvent.selectOptions(defenderSelect(), defender)
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  }

  it('clears the defender after submitting, not just the text', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await submit('help defence, unclear', '1')

    expect(useStore.getState().notes[0].defenderId).toBe(1)
    expect((defenderSelect() as HTMLSelectElement).value).toBe('')
  })

  it('does not attribute the next note to the previous defender', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await submit('about Bell', '1')
    await submit('general observation')

    const { notes } = useStore.getState()
    expect(notes.map(n => n.defenderId)).toEqual([1, undefined])
  })

  it('still records a defender when one is picked for the second note', async () => {
    render(<TopBar onNewSession={vi.fn()} />)
    await openNotes()
    await submit('about Bell', '1')
    await submit('about Cruz', '2')

    expect(useStore.getState().notes.map(n => n.defenderId)).toEqual([1, 2])
  })
})
