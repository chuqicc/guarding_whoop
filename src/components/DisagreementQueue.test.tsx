import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DisagreementQueue from './DisagreementQueue'
import type { DiffRun } from '../utils/diffRuns'
import type { AnnotationDocument } from '../utils/annotationDocument'

const docs = (): [AnnotationDocument, AnnotationDocument] => {
  const base = {
    gameId: 'G1', quarter: 1, sourceFile: 'x.json',
    sourceFormat: 'json' as const,
    players: {
      1: { name: 'Bell', jersey: '23' },
      2: { name: 'Cruz', jersey: '11' },
      6: { name: 'Hall', jersey: '7' },
      7: { name: 'King', jersey: '12' },
    },
    buckets: new Map(),
  }
  return [{ ...base, annotator: 'Alice' }, { ...base, annotator: 'Bob' }]
}

const run = (over: Partial<DiffRun>): DiffRun => ({
  defenderId: 1, status: 'disagree',
  startBucket: 400, endBucket: 399.5,
  bucketCount: 2, durationS: 1, a: 6, b: 7,
  ...over,
})

function renderQueue(runs: DiffRun[], selected: DiffRun | null = null, onSelect = vi.fn()) {
  const [docA, docB] = docs()
  const r = render(
    <DisagreementQueue
      runs={runs} docA={docA} docB={docB}
      annotatorA="Alice" annotatorB="Bob"
      selected={selected} onSelect={onSelect}
    />,
  )
  return { ...r, onSelect }
}

const rows = () => screen.queryAllByRole('row')

describe('DisagreementQueue', () => {
  it('says so plainly when there is nothing to review', () => {
    renderQueue([])
    expect(screen.getByText(/agree on every comparable cell/)).toBeInTheDocument()
  })

  it('shows both answers in full, which a narrow bar cannot', () => {
    renderQueue([run({ a: 6, b: 7 })])
    const text = rows()[0].textContent ?? ''
    expect(text).toContain('Alice: #7')
    expect(text).toContain('Bob: #12')
  })

  it('spells out GUARD_NONE rather than a bare symbol', () => {
    renderQueue([run({ a: 'GUARD_NONE', b: 6 })])
    expect(rows()[0].textContent).toContain('∅ none')
  })

  it('writes an em dash where one annotator left it blank', () => {
    renderQueue([run({ status: 'coverage-mismatch', a: undefined, b: 6 })])
    expect(rows()[0].textContent).toContain('—')
  })

  it('puts the longest disagreement first by default', () => {
    // A three-second disagreement is a clearer protocol failure than a
    // half-second boundary wobble.
    renderQueue([
      run({ startBucket: 400, durationS: 0.5 }),
      run({ startBucket: 390, durationS: 3 }),
    ])
    expect(rows()[0].textContent).toContain('3.0s')
  })

  it('can be re-sorted into game order', async () => {
    renderQueue([
      run({ startBucket: 390, durationS: 3 }),
      run({ startBucket: 400, durationS: 0.5 }),
    ])
    await userEvent.selectOptions(screen.getByLabelText(/Sort/), 'clock')
    expect(rows()[0].textContent).toContain('6:40')      // bucket 400 first
  })

  it('filters to one kind of disagreement', async () => {
    renderQueue([
      run({ status: 'disagree' }),
      run({ status: 'defense-mismatch', startBucket: 390 }),
    ])
    expect(rows()).toHaveLength(2)
    await userEvent.selectOptions(screen.getByLabelText(/Type/), 'defense-mismatch')
    expect(rows()).toHaveLength(1)
  })

  it('filters to one defender', async () => {
    renderQueue([
      run({ defenderId: 1 }),
      run({ defenderId: 2, startBucket: 390 }),
    ])
    await userEvent.selectOptions(screen.getByLabelText(/Defender/), '2')
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('#11')
  })

  it('says so when a filter leaves nothing, rather than showing a blank table', async () => {
    // Defender 1 has only an attacker disagreement; the defence one is #2's.
    renderQueue([
      run({ status: 'disagree', defenderId: 1 }),
      run({ status: 'defense-mismatch', defenderId: 2, startBucket: 390 }),
    ])
    await userEvent.selectOptions(screen.getByLabelText(/Defender/), '1')
    await userEvent.selectOptions(screen.getByLabelText(/Type/), 'defense-mismatch')
    expect(screen.getByText(/No disagreements match this filter/)).toBeInTheDocument()
  })

  it('reports position in the list, which the n/p stepper never did', () => {
    const rs = [run({ startBucket: 400, durationS: 3 }), run({ startBucket: 390, durationS: 1 })]
    renderQueue(rs, rs[1])
    expect(screen.getByText(/on 2 of 2/)).toBeInTheDocument()
  })

  it('calls back with the run when a row is clicked', async () => {
    const r = run({})
    const { onSelect } = renderQueue([r])
    await userEvent.click(rows()[0])
    expect(onSelect).toHaveBeenCalledWith(r)
  })

  it('counts each kind in the filter, so the split is visible without filtering', () => {
    renderQueue([
      run({ status: 'disagree' }),
      run({ status: 'disagree', startBucket: 395 }),
      run({ status: 'defense-mismatch', startBucket: 390 }),
    ])
    expect(screen.getByRole('option', { name: /Different attacker \(2\)/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Defending team \(1\)/ })).toBeInTheDocument()
  })
})
