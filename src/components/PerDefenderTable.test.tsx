import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PerDefenderTable from './PerDefenderTable'
import { computeAgreement } from '../utils/agreement'
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'
import type { AttackerId } from '../store/useStore'

const WINDOW = [400, 399.5, 399, 398.5]

/** `per` maps defenderId -> the attacker they guard in every bucket. */
function doc(annotator: string, per: Record<number, AttackerId>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: 'active', defTeam: 'AAA', frameStart: i,
      assignments: new Map(Object.entries(per).map(([d, a]) => [Number(d), a])),
      confidence: new Map(), shot: false, rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: {
      1: { name: 'Bell', jersey: '23' },
      2: { name: 'Cruz', jersey: '11' },
    },
    buckets,
  }
}

function renderTable(docA: AnnotationDocument, docB: AnnotationDocument, onSelect = vi.fn()) {
  const report = computeAgreement(docA, docB)
  const r = render(
    <PerDefenderTable report={report} docA={docA} docB={docB} onSelectDefender={onSelect} />,
  )
  return { ...r, onSelect }
}

const bodyRows = () => within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1)

describe('PerDefenderTable', () => {
  it('renders a row per defender', () => {
    renderTable(doc('Alice', { 1: 6, 2: 7 }), doc('Bob', { 1: 6, 2: 7 }))
    expect(bodyRows()).toHaveLength(2)
  })

  it('shows each defender own agreement rate, not just the headline', () => {
    // Defender 1 agrees everywhere; defender 2 never does.
    renderTable(doc('Alice', { 1: 6, 2: 7 }), doc('Bob', { 1: 6, 2: 6 }))
    const text = bodyRows().map(r => r.textContent ?? '')
    expect(text.some(t => t.includes('#23') && t.includes('100.0%'))).toBe(true)
    expect(text.some(t => t.includes('#11') && t.includes('0.0%'))).toBe(true)
  })

  it('puts the noisiest defender first by default', () => {
    renderTable(doc('Alice', { 1: 6, 2: 7 }), doc('Bob', { 1: 6, 2: 6 }))
    expect(bodyRows()[0].textContent).toContain('#11')     // 4 disagreements
  })

  it('can be re-sorted by jersey', async () => {
    renderTable(doc('Alice', { 1: 6, 2: 7 }), doc('Bob', { 1: 6, 2: 6 }))
    await userEvent.click(screen.getByText(/Defender/))
    expect(bodyRows()[0].textContent).toContain('#11')     // jersey 11 < 23
  })

  it('writes an em dash for an undefined κ rather than a misleading zero', () => {
    // Both annotators only ever gave one answer, so κ is undefined.
    renderTable(doc('Alice', { 1: 6 }), doc('Bob', { 1: 6 }))
    expect(bodyRows()[0].textContent).toContain('—')
    expect(screen.getByText(/κ is undefined/)).toBeInTheDocument()
  })

  it('reports the comparison count behind each rate', () => {
    renderTable(doc('Alice', { 1: 6 }), doc('Bob', { 1: 7 }))
    expect(bodyRows()[0].textContent).toContain('4')       // four buckets
  })

  it('calls back with the defender when a row is clicked', async () => {
    const { onSelect } = renderTable(doc('Alice', { 1: 6 }), doc('Bob', { 1: 7 }))
    await userEvent.click(bodyRows()[0])
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('renders nothing when there is nothing to compare', () => {
    const a = doc('Alice', { 1: 6 })
    const b = doc('Bob', { 1: 6 })
    for (const k of [...b.buckets.keys()]) b.buckets.delete(k)
    const { container } = renderTable(a, b)
    expect(container).toBeEmptyDOMElement()
  })
})
