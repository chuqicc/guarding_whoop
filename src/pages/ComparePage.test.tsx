import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ComparePage from './ComparePage'
import { useStore } from '../store/useStore'

// A minimal v2 export, built inline so the test states exactly what it feeds in.
function exportJSON(opts: {
  annotator: string
  quarter?: number
  gameId?: string
  assignments: Record<string, Record<number, number | 'NONE'>>
}) {
  const buckets = Object.entries(opts.assignments).map(([bucket, defs], i) => ({
    bucket: Number(bucket),
    status: 'active',
    frame_start: i * 12,
    frame_end: i * 12 + 11,
    quarter_clock: Number(bucket),
    def_team: 'AAA',
    att_team: 'BBB',
    assignments: Object.entries(defs).map(([def, att]) => ({ def: Number(def), att })),
  }))
  return JSON.stringify({
    format: 'guard-annotation/v2',
    meta: {
      game_id: opts.gameId ?? 'G1',
      quarter: opts.quarter ?? 1,
      mode: 'quarter',
      source_file: 'q1',
      players: {
        1: { name: 'Def One', jersey: '23', team: 'AAA' },
        6: { name: 'Att One', jersey: '7', team: 'BBB' },
        7: { name: 'Att Two', jersey: '12', team: 'BBB' },
      },
      annotator: opts.annotator,
    },
    buckets,
  })
}

const file = (text: string, name = 'a.json') =>
  new File([text], name, { type: 'application/json' })

async function drop(side: 0 | 1, f: File) {
  const inputs = document.querySelectorAll('input[type="file"]')
  await userEvent.upload(inputs[side] as HTMLInputElement, f)
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ frames: [], quarterMeta: null })
})

describe('ComparePage', () => {
  it('accepts both JSON and CSV', () => {
    render(<ComparePage onBack={vi.fn()} />)
    for (const input of document.querySelectorAll('input[type="file"]')) {
      expect(input.getAttribute('accept')).toBe('.json,.csv')
    }
  })

  it('shows who each side is once a file is loaded', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', assignments: { '400': { 1: 6 } } })))
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText(/G1 · Q1/)).toBeInTheDocument()
  })

  it('refuses to compare two different quarters', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', quarter: 1, assignments: { '400': { 1: 6 } } })))
    await drop(1, file(exportJSON({ annotator: 'Bob', quarter: 2, assignments: { '400': { 1: 6 } } })))

    expect(await screen.findByRole('alert')).toHaveTextContent(/different quarters/)
    // and no numbers are shown, because they would be meaningless
    expect(screen.queryByText('Raw agreement')).not.toBeInTheDocument()
  })

  it('refuses to compare two different games', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', gameId: 'G1', assignments: { '400': { 1: 6 } } })))
    await drop(1, file(exportJSON({ annotator: 'Bob', gameId: 'G2', assignments: { '400': { 1: 6 } } })))
    expect(await screen.findByRole('alert')).toHaveTextContent(/different games/)
  })

  it('reports agreement and shows the exclusion counts on the face of it', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({
      annotator: 'Alice',
      assignments: { '400': { 1: 6 }, '399.5': { 1: 6 } },
    })))
    await drop(1, file(exportJSON({
      annotator: 'Bob',
      assignments: { '400': { 1: 6 }, '399.5': { 1: 7 } },
    })))

    expect(await screen.findByText('Raw agreement')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    // Exclusion counters are always visible, not hidden behind a toggle.
    // (Some labels also appear in the DiffGrid legend, hence getAllByText.)
    for (const label of ['Only one annotated', 'Dead ball', 'Defending team differs']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('warns when both files carry the same annotator name', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', assignments: { '400': { 1: 6 } } })))
    await drop(1, file(exportJSON({ annotator: 'Alice', assignments: { '400': { 1: 6 } } })))

    await waitFor(() => {
      expect(screen.getAllByRole('alert').some(n => /same annotator/.test(n.textContent ?? '')))
        .toBe(true)
    })
  })

  it('surfaces the caveats rather than showing a bare number', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', assignments: { '400': { 1: 6 } } })))
    await drop(1, file(exportJSON({ annotator: 'Bob', assignments: { '400': { 1: 6 } } })))
    expect(await screen.findByText(/How to read these numbers/)).toBeInTheDocument()
  })

  it('explains an unreadable file instead of failing silently', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(JSON.stringify({ pairs: [] }), 'legacy.json'))
    expect(await screen.findByText(/Re-export/i)).toBeInTheDocument()
  })

  it('says jumping to playback is unavailable without tracking data loaded', async () => {
    render(<ComparePage onBack={vi.fn()} />)
    await drop(0, file(exportJSON({ annotator: 'Alice', assignments: { '400': { 1: 6 } } })))
    await drop(1, file(exportJSON({ annotator: 'Bob', assignments: { '400': { 1: 7 } } })))
    expect(await screen.findByText(/no tracking data loaded/)).toBeInTheDocument()
  })
})
