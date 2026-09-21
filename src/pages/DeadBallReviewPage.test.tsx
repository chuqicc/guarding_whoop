import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

// Konva draws to a real canvas context, which jsdom lacks.
vi.mock('react-konva', () => {
  const passthrough = (name: string) =>
    ({ children }: { children?: ReactNode }) => <div data-konva={name}>{children}</div>
  return {
    Stage: passthrough('Stage'), Layer: passthrough('Layer'), Group: passthrough('Group'),
    Circle: passthrough('Circle'), Text: passthrough('Text'),
    Arrow: passthrough('Arrow'), Image: passthrough('Image'),
  }
})

const { default: DeadBallReviewPage } = await import('./DeadBallReviewPage')
const { useStore } = await import('../store/useStore')
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'
import type { QuarterMeta, Player, TrackingFrame } from '../store/useStore'
import type { LoadedTracking } from '../components/TrackingDropZone'

const WINDOW = [400, 399.5, 399, 398.5, 398]

function doc(annotator: string, dead: number[], quarter = 1, gameId = 'G1'): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: dead.includes(bucket) ? 'dead' : 'active',
      defTeam: 'AAA', frameStart: i,
      assignments: new Map(), confidence: new Map(), shot: false, rebound: false,
    })
  })
  return {
    annotator, gameId, quarter,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: {}, buckets,
  }
}

const TEAM_A = 100, TEAM_B = 200
const players: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' },
]
// parseQuarterJSON guarantees frames[i].frameIndex === i, so a document's
// frameStart is an index into this array. The fixture must honour that.
const frames: TrackingFrame[] = WINDOW.map((qc, i) => ({
  frameIndex: i, momentId: 1000 + i, quarterClock: qc, shotClock: 24,
  ballX: 0, ballY: 0, ballZ: 0,
  players: players.map(p => ({ id: p.id, teamId: p.teamId, x: 10, y: 10 })),
}))

function tracking(gameId = 'G1', quarter = 1): LoadedTracking {
  const quarterMeta: QuarterMeta = {
    filename: 'review_test', gameId, quarter,
    teamA: { teamId: TEAM_A, abbr: 'AAA', players: [players[0]] },
    teamB: { teamId: TEAM_B, abbr: 'BBB', players: [players[1]] },
    defendingTeamId: TEAM_A, totalFrames: frames.length,
    startClock: 400, endClock: 398,
  }
  return {
    filename: 'review_test.json', frames, quarterMeta,
    playerDict: Object.fromEntries(players.map(p => [p.id, p])),
  }
}

function Page(props: {
  docA: AnnotationDocument | null
  docB: AnnotationDocument | null
  tracking?: LoadedTracking | null
}) {
  return (
    <DeadBallReviewPage
      docA={props.docA} docB={props.docB}
      tracking={props.tracking ?? null}
      videoUrl={null} setVideoFile={() => {}}
      onBack={vi.fn()}
    />
  )
}

/** A quarter open in the annotate session, to prove this page never touches it. */
function annotateSessionOpen() {
  useStore.setState({
    frames, quarterMeta: tracking().quarterMeta, currentFrame: 3,
    cellAnnotations: [{ id: 'keep', defenderId: 1, attackerId: 6, shotClockBucket: 400 }],
  })
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    frames: [], quarterMeta: null, currentFrame: 0,
    cellAnnotations: [], deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
  })
})

describe('DeadBallReviewPage', () => {
  it('asks for files when none are loaded', () => {
    render(<Page docA={null} docB={null} />)
    expect(screen.getByText(/Load two annotators' files/)).toBeInTheDocument()
  })

  it('counts disagreement regions, not buckets', () => {
    // A 1.5s offset is one thing to review, not three.
    render(<Page docA={doc('Alice', [400, 399.5, 399])} docB={doc('Bob', [])} tracking={tracking()} />)
    expect(screen.getByText(/1 disagreement\(s\)/)).toBeInTheDocument()
  })

  it('names who called it dead and who called it live', () => {
    const { container } = render(
      <Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />,
    )
    expect(container.textContent).toMatch(/Alice.*: dead/s)
    expect(screen.getByText(/1 \/ 1/)).toBeInTheDocument()
  })

  it('refuses to explain the disagreement with a different quarter', () => {
    render(
      <Page docA={doc('Alice', [399], 1)} docB={doc('Bob', [], 1)} tracking={tracking('G1', 2)} />,
    )
    const alerts = screen.getAllByRole('alert').map(a => a.textContent ?? '')
    expect(alerts.some(t => /Loaded tracking data is G1 Q2/.test(t))).toBe(true)
  })

  it('says so when no tracking was loaded on the compare page', () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} />)
    const alerts = screen.getAllByRole('alert').map(a => a.textContent ?? '')
    expect(alerts.some(t => /No tracking data loaded/.test(t))).toBe(true)
  })

  it('moves its own playhead to the region when stepping with n', async () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />)
    await userEvent.keyboard('n')
    // bucket 399 is the third in the window -> frame index 2
    expect(screen.getByText(/frame 2/)).toBeInTheDocument()
  })

  it('does not move the playhead when the tracking is the wrong quarter', async () => {
    render(
      <Page docA={doc('Alice', [399], 1)} docB={doc('Bob', [], 1)} tracking={tracking('G1', 2)} />,
    )
    await userEvent.keyboard('n')
    expect(screen.getByText(/frame 0/)).toBeInTheDocument()
  })

  it('wraps around when stepping past the last region', async () => {
    render(<Page docA={doc('Alice', [400])} docB={doc('Bob', [398.5])} tracking={tracking()} />)
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
    await userEvent.keyboard('n')
    expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument()
    await userEvent.keyboard('n')
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
  })

  it('shows the game clock large, as the anchor for finding the video by hand', async () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />)
    await userEvent.keyboard('n')
    expect(screen.getByText(/Q1\s+6:39\.0/)).toBeInTheDocument()
    expect(screen.getByText(/scrub the video to this clock reading/)).toBeInTheDocument()
  })

  it('says there is nothing to review when the two agree', () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [399])} tracking={tracking()} />)
    expect(screen.getByText(/No dead-ball disagreements/)).toBeInTheDocument()
  })

  it('leaves an open annotate session completely untouched', async () => {
    // The whole reason this page owns its data: loadQuarter would clear
    // cellAnnotations and reset undo, and the next edit would then persist the
    // emptied set over the annotator's saved file.
    annotateSessionOpen()
    const before = {
      frame: useStore.getState().currentFrame,
      annotations: useStore.getState().cellAnnotations.length,
    }

    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />)
    await userEvent.keyboard('n')
    await userEvent.keyboard('n')

    expect(useStore.getState().currentFrame).toBe(before.frame)
    expect(useStore.getState().cellAnnotations).toHaveLength(before.annotations)
  })
})

describe('panel sizing', () => {
  it('lets the video and court row be resized', () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />)
    const handles = screen.getAllByRole('separator')
    // one between video and court, one under the whole media row
    expect(handles.length).toBeGreaterThanOrEqual(2)
    expect(handles.map(h => h.getAttribute('aria-orientation')))
      .toEqual(expect.arrayContaining(['vertical', 'horizontal']))
  })

  it('names each handle so it is usable without a mouse', () => {
    render(<Page docA={doc('Alice', [399])} docB={doc('Bob', [])} tracking={tracking()} />)
    for (const h of screen.getAllByRole('separator')) {
      expect(h).toHaveAttribute('tabindex', '0')
      expect(h.getAttribute('aria-label')).toMatch(/Resize/)
    }
  })
})
