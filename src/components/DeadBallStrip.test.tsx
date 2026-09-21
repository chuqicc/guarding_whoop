import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeadBallStrip from './DeadBallStrip'
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'
import { makeScale } from '../utils/timelineScale'

const window = [400, 399.5, 399, 398.5, 398, 397.5]

function doc(annotator: string, dead: number[]): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  window.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: dead.includes(bucket) ? 'dead' : 'active',
      defTeam: 'AAA',
      frameStart: i * 12,
      assignments: new Map(),
      confidence: new Map(),
      shot: false,
      rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: {}, buckets,
  }
}

describe('DeadBallStrip', () => {
  it('shows both annotators as their own lane', () => {
    render(<DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [399.5])} />)
    // Each name now appears in its lane label, the chart legend and the
    // chart's direct label, so assert presence rather than uniqueness.
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
  })

  it('reports agreed and disagreed bucket counts, with the direction', () => {
    // Alice 400 + 399.5, Bob 399.5 + 399 -> 1 agreed, 1 each way
    const { container } = render(
      <DeadBallStrip docA={doc('Alice', [400, 399.5])} docB={doc('Bob', [399.5, 399])} />,
    )
    expect(container.textContent).toContain('agreed on 1 bucket(s)')
    expect(container.textContent).toContain('disagreed on 2')
    // the direction matters: who over-called dead is the actionable part
    expect(container.textContent).toContain('Alice only 1')
    expect(container.textContent).toContain('Bob only 1')
  })

  it('describes a fully-shared stoppage as agreed', () => {
    render(<DeadBallStrip docA={doc('Alice', [399.5, 399])} docB={doc('Bob', [399.5, 399])} />)
    expect(screen.getAllByLabelText(/marked all of it too/).length).toBe(2)
  })

  it('describes a stoppage the other side missed entirely', () => {
    render(<DeadBallStrip docA={doc('Alice', [399.5, 399])} docB={doc('Bob', [])} />)
    expect(screen.getByLabelText(/Bob marked none of it/)).toBeInTheDocument()
  })

  it('describes a partial overlap as a boundary disagreement', () => {
    // Alice stops two buckets earlier; the tail is shared.
    render(<DeadBallStrip docA={doc('Alice', [400, 399.5, 399])} docB={doc('Bob', [399])} />)
    expect(screen.getByLabelText(/Bob marked 1 of 3 bucket\(s\), 2 not shared/)).toBeInTheDocument()
  })

  it('warns when one side marked no dead ball at all', () => {
    // A CSV without a gamestatus column parses as all-active, which would
    // otherwise look like flawless agreement.
    render(<DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [])} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Bob marked no dead ball at all/)
  })

  it('warns differently when neither side marked any', () => {
    render(<DeadBallStrip docA={doc('Alice', [])} docB={doc('Bob', [])} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/agreement by absence/)
  })

  it('does not warn when both sides used the flag', () => {
    render(<DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [399])} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('jumps the playhead to the start of a span when clicked', async () => {
    const onJump = vi.fn()
    render(<DeadBallStrip docA={doc('Alice', [399])} docB={doc('Bob', [])} onJumpToFrame={onJump} />)
    await userEvent.click(screen.getByLabelText(/Alice · dead/))
    expect(onJump).toHaveBeenCalledWith(24)      // third bucket in the window
  })

  it('renders nothing when the two files share no buckets', () => {
    const a: AnnotationDocument = { ...doc('Alice', []), buckets: new Map() }
    const { container } = render(<DeadBallStrip docA={a} docB={doc('Bob', [])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('places a span at the x the shared scale dictates', () => {
    // The whole feature depends on the lanes lining up with the defender rows
    // below, which only holds while both use makeScale.
    render(<DeadBallStrip docA={doc('Alice', [399])} docB={doc('Bob', [])} />)
    const bar = screen.getByLabelText(/Alice · dead/)
    const expected = makeScale(window).xOf(399)   // 1.0s in => 26px
    expect(bar.style.left).toBe(`${expected}px`)
  })
})

describe('annotator identity colour', () => {
  it('gives each annotator their own hue', () => {
    const { container } = render(
      <DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [399])} />,
    )
    const bars = [...container.querySelectorAll('button')] as HTMLElement[]
    const backgrounds = bars.map(b => b.style.background)

    expect(backgrounds.some(bg => bg.includes('--annot-a'))).toBe(true)
    expect(backgrounds.some(bg => bg.includes('--annot-b'))).toBe(true)
  })

  it('separates identity from agreement — hue says who, opacity says whether', () => {
    // Both marked 399.5; only Alice marked 400.
    const { container } = render(
      <DeadBallStrip docA={doc('Alice', [400, 399.5])} docB={doc('Bob', [399.5])} />,
    )
    const bars = [...container.querySelectorAll('button')] as HTMLElement[]
    const opacities = bars.map(b => parseFloat(b.style.opacity))

    // Alice's span covers a contested bucket, so it is solid; Bob's is fully shared.
    expect(opacities).toContain(1)
    expect(opacities.some(o => o < 1)).toBe(true)
  })

  it('names both annotators in the legend, so colour is never the only cue', () => {
    const { container } = render(
      <DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [399.5])} />,
    )
    expect(container.textContent).toContain('Alice')
    expect(container.textContent).toContain('Bob')
  })

  it('uses CSS variables so both themes work', () => {
    const { container } = render(
      <DeadBallStrip docA={doc('Alice', [399.5])} docB={doc('Bob', [399])} />,
    )
    const bars = [...container.querySelectorAll('button')] as HTMLElement[]
    for (const b of bars) {
      expect(b.style.background).toMatch(/^var\(--annot-[ab]\)$/)
    }
  })
})
