import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DefenseTeamStrip from './DefenseTeamStrip'
import { makeScale } from '../utils/timelineScale'
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'

const WINDOW = [400, 399.5, 399, 398.5, 398]

function doc(annotator: string, teams: Record<number, string | undefined>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: 'active', defTeam: teams[bucket], frameStart: i,
      assignments: new Map(), confidence: new Map(), shot: false, rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: {}, buckets,
  }
}

const all = (team: string, override: Record<number, string | undefined> = {}) => {
  const out: Record<number, string | undefined> = {}
  for (const b of WINDOW) out[b] = team
  return { ...out, ...override }
}

describe('DefenseTeamStrip', () => {
  it('shows a lane per annotator', () => {
    const { container } = render(
      <DefenseTeamStrip docA={doc('Alice', all('AAA'))} docB={doc('Bob', all('AAA'))} />,
    )
    expect(container.textContent).toContain('Alice')
    expect(container.textContent).toContain('Bob')
  })

  it('says so plainly when the two agree throughout', () => {
    render(<DefenseTeamStrip docA={doc('Alice', all('AAA'))} docB={doc('Bob', all('AAA'))} />)
    expect(screen.getByText(/agreed throughout/)).toBeInTheDocument()
  })

  it('counts contested stretches, not just buckets', () => {
    // Three consecutive buckets differ: one stretch to review, not three.
    render(
      <DefenseTeamStrip
        docA={doc('Alice', all('AAA'))}
        docB={doc('Bob', all('AAA', { 399.5: 'BBB', 399: 'BBB', 398.5: 'BBB' }))}
      />,
    )
    expect(screen.getByText(/1 stretch\(es\), 3 bucket\(s\) disagree/)).toBeInTheDocument()
  })

  it('names both teams in the legend, so colour is never the only cue', () => {
    const { container } = render(
      <DefenseTeamStrip docA={doc('Alice', all('AAA'))} docB={doc('Bob', all('BBB'))} />,
    )
    expect(container.textContent).toContain('AAA')
    expect(container.textContent).toContain('BBB')
  })

  it('states which team each annotator named, in the bar label', () => {
    render(
      <DefenseTeamStrip docA={doc('Alice', all('AAA'))} docB={doc('Bob', all('BBB'))} />,
    )
    expect(screen.getByLabelText(/Alice: AAA defending/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Bob: BBB defending/)).toBeInTheDocument()
  })

  it('says how much of a span the other annotator contests', () => {
    render(
      <DefenseTeamStrip
        docA={doc('Alice', all('AAA'))}
        docB={doc('Bob', all('AAA', { 399: 'BBB' }))}
      />,
    )
    expect(screen.getByLabelText(/Bob names a different team for 1 of 5 bucket\(s\)/))
      .toBeInTheDocument()
  })

  it('colours by team so the strip reads like the court', () => {
    const { container } = render(
      <DefenseTeamStrip docA={doc('Alice', all('AAA'))} docB={doc('Bob', all('BBB'))} />,
    )
    const backgrounds = [...container.querySelectorAll('button')]
      .map(b => (b as HTMLElement).style.background)
    expect(backgrounds.some(bg => bg.includes('--team-a'))).toBe(true)
    expect(backgrounds.some(bg => bg.includes('--team-b'))).toBe(true)
  })

  it('jumps to the start of a span when clicked', async () => {
    const onJump = vi.fn()
    render(
      <DefenseTeamStrip
        docA={doc('Alice', all('AAA', { 399: 'BBB' }))}
        docB={doc('Bob', all('AAA'))}
        onJumpToFrame={onJump}
      />,
    )
    await userEvent.click(screen.getByLabelText(/Alice: BBB defending/))
    expect(onJump).toHaveBeenCalledWith(2)     // third bucket in the window
  })

  it('reports buckets only one side labelled, separately from disagreements', () => {
    render(
      <DefenseTeamStrip
        docA={doc('Alice', all('AAA'))}
        docB={doc('Bob', all('AAA', { 399: undefined }))}
      />,
    )
    expect(screen.getByText(/1 bucket\(s\) unlabelled by one side/)).toBeInTheDocument()
    expect(screen.getByText(/agreed throughout/)).toBeInTheDocument()
  })

  it('uses the shared scale when given one', () => {
    const shared = makeScale(WINDOW)
    render(
      <DefenseTeamStrip
        docA={doc('Alice', all('AAA', { 399: 'BBB' }))}
        docB={doc('Bob', all('AAA'))}
        scale={shared}
      />,
    )
    const bar = screen.getByLabelText(/Alice: BBB defending/)
    expect(bar.style.left).toBe(`${shared.xOf(399)}px`)
  })

  it('renders nothing when the files share no buckets', () => {
    const a = doc('Alice', all('AAA'))
    const b = doc('Bob', all('AAA'))
    for (const k of [...b.buckets.keys()]) b.buckets.delete(k)
    const { container } = render(<DefenseTeamStrip docA={a} docB={b} />)
    expect(container).toBeEmptyDOMElement()
  })
})
