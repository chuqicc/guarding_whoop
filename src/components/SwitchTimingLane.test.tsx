import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwitchTimingLane from './SwitchTimingLane'
import { computeAgreement } from '../utils/agreement'
import { makeScale } from '../utils/timelineScale'
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'
import type { AttackerId } from '../store/useStore'

const WINDOW = [400, 399.5, 399, 398.5, 398]

/** Defender 1 guards `first` until `switchAt`, then `second`. */
function doc(annotator: string, switchAt: number | null, first = 6, second = 7): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    const att: AttackerId = switchAt === null || bucket >= switchAt ? first : second
    buckets.set(bucket, {
      status: 'active', defTeam: 'AAA', frameStart: i,
      assignments: new Map([[1, att]]),
      confidence: new Map(), shot: false, rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: { 1: { name: 'Def One', jersey: '23' } },
    buckets,
  }
}

const scale = makeScale(WINDOW)

function renderLane(docA: AnnotationDocument, docB: AnnotationDocument, onJump = vi.fn()) {
  const report = computeAgreement(docA, docB)
  const r = render(
    <SwitchTimingLane
      report={report} docA={docA} docB={docB} scale={scale} onJumpToFrame={onJump}
    />,
  )
  return { ...r, report, onJump }
}

describe('SwitchTimingLane', () => {
  it('renders nothing when neither annotator recorded a switch', () => {
    const { container } = renderLane(doc('Alice', null), doc('Bob', null))
    expect(container).toBeEmptyDOMElement()
  })

  it('splits precision and recall, which a single F1 hides', () => {
    const { container } = renderLane(doc('Alice', 399.5), doc('Bob', 399))
    expect(container.textContent).toMatch(/precision \d\.\d\d \/ recall \d\.\d\d/)
  })

  it('reports the systematic timing offset and says who is earlier', () => {
    // Alice's switch begins one bucket before Bob's, every time.
    const { container } = renderLane(doc('Alice', 399.5), doc('Bob', 399))
    expect(container.textContent).toMatch(/median offset/)
    expect(container.textContent).toMatch(/Alice consistently earlier/)
  })

  it('draws a tick per annotator per switch', () => {
    renderLane(doc('Alice', 399.5), doc('Bob', 399))
    expect(screen.getByLabelText(/Alice · switch at/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Bob · switch at/)).toBeInTheDocument()
  })

  it('states the other annotator time and the offset on a matched tick', () => {
    renderLane(doc('Alice', 399.5), doc('Bob', 399))
    expect(screen.getByLabelText(/Alice · switch at.*Bob at.*bucket/)).toBeInTheDocument()
  })

  it('calls out a switch the other annotator never recorded', () => {
    renderLane(doc('Alice', 399), doc('Bob', null))
    expect(screen.getByLabelText(/Bob did not record one here/)).toBeInTheDocument()
  })

  it('warns when one annotator records switches the other never does', () => {
    // precision/recall cannot carry this: with nothing matched they are both
    // 0, which hides the most one-sided case there is.
    const { container } = renderLane(doc('Alice', 399), doc('Bob', null))
    expect(container.textContent).toMatch(/Alice records 1 switch\(es\) Bob does not/)
  })

  it('stays quiet when the two record the same switches', () => {
    const { container } = renderLane(doc('Alice', 399), doc('Bob', 399))
    expect(container.textContent).not.toMatch(/does not/)
  })

  it('places ticks on the shared scale', () => {
    renderLane(doc('Alice', 399.5), doc('Bob', 399))
    const tick = screen.getByLabelText(/Alice · switch at/)
    // The switch begins at the first bucket of the new attacker.
    const expected = scale.xOf(399) - 4
    expect(parseFloat(tick.style.left)).toBe(expected)
  })

  it('jumps to the frame when a tick is clicked', async () => {
    const { onJump } = renderLane(doc('Alice', 399.5), doc('Bob', 399))
    await userEvent.click(screen.getByLabelText(/Alice · switch at/))
    expect(onJump).toHaveBeenCalled()
  })

  it('labels the defender row', () => {
    const { container } = renderLane(doc('Alice', 399.5), doc('Bob', 399))
    expect(container.textContent).toContain('#23')
    expect(container.textContent).toContain('Def One')
  })
})
