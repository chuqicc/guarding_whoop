import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DeadBallStrip from './DeadBallStrip'
import { makeScale, ticks, LABEL_W } from '../utils/timelineScale'
import TimeAxis from './TimeAxis'
import DiffGrid from './DiffGrid'
import { computeAgreement } from '../utils/agreement'
import type { AnnotationDocument, DocumentBucket } from '../utils/annotationDocument'
import type { AttackerId } from '../store/useStore'

/**
 * The dead-ball lanes are only meaningful if a bucket sits at the same x as
 * that same bucket in the defender rows underneath. Both components must read
 * the shared scale; if one ever grows its own copy, this fails loudly instead
 * of the UI quietly lying about where a stoppage was.
 */

const window = [400, 399.5, 399, 398.5, 398, 397.5]

function doc(
  annotator: string,
  dead: number[],
  assign: Record<string, Record<number, AttackerId>> = {},
): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  window.forEach((bucket, i) => {
    buckets.set(bucket, {
      status: dead.includes(bucket) ? 'dead' : 'active',
      defTeam: 'AAA',
      frameStart: i * 12,
      assignments: new Map(
        Object.entries(assign[String(bucket)] ?? {}).map(([d, a]) => [Number(d), a]),
      ),
      confidence: new Map(),
      shot: false,
      rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 1,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: { 1: { name: 'Def One', jersey: '23' } },
    buckets,
  }
}

const leftOf = (el: HTMLElement) => parseFloat(el.style.left)

describe('lane alignment between the dead-ball strip and the defender grid', () => {
  // Alice marks 399 dead; both annotate defender 1 across the window, so the
  // grid has a run starting at the same bucket.
  const assignA = { '400': { 1: 6 }, '399.5': { 1: 6 }, '399': { 1: 6 }, '398.5': { 1: 6 } }
  const docA = doc('Alice', [399], assignA)
  const docB = doc('Bob', [], assignA)
  const report = computeAgreement(docA, docB)

  it('puts a dead span and a grid run for the same bucket at the same x', () => {
    const strip = render(<DeadBallStrip docA={docA} docB={docB} />)
    const deadBar = screen.getByLabelText(/Alice · dead/)
    const deadX = leftOf(deadBar)
    strip.unmount()

    render(<DiffGrid report={report} docA={docA} docB={docB} />)
    // The grid breaks its run at the dead bucket, so a bar starts there too.
    const gridBars = screen.getAllByLabelText(/·/) as HTMLElement[]
    const xs = gridBars.map(leftOf)

    expect(xs).toContain(deadX)
  })

  it('agrees on the origin — the first bucket is x = 0 in both', () => {
    const allDead = doc('Alice', window, assignA)
    const strip = render(<DeadBallStrip docA={allDead} docB={docB} />)
    expect(leftOf(screen.getByLabelText(/Alice · dead/))).toBe(0)
    strip.unmount()

    render(<DiffGrid report={computeAgreement(allDead, docB)} docA={allDead} docB={docB} />)
    const xs = (screen.getAllByLabelText(/·/) as HTMLElement[]).map(leftOf)
    expect(Math.min(...xs)).toBe(0)
  })
})

describe('asymmetric bucket ranges — the case the symmetric fixtures missed', () => {
  // DeadBallStrip compares the INTERSECTION of the two files' buckets while
  // DiffGrid renders their UNION. When one file covers an earlier bucket than
  // the other, each deriving its own scale puts the origins in different
  // places and every lane shifts relative to the grid.
  const wide = [400, 399.5, 399, 398.5]      // A starts earlier
  const narrow = [399, 398.5]                // B starts later

  function docFor(annotator: string, buckets: number[], dead: number[]): AnnotationDocument {
    const m = new Map<number, DocumentBucket>()
    buckets.forEach((bucket, i) => {
      m.set(bucket, {
        status: dead.includes(bucket) ? 'dead' : 'active',
        defTeam: 'AAA',
        frameStart: i * 12,
        assignments: new Map([[1, 6 as AttackerId]]),
        confidence: new Map(),
        shot: false,
        rebound: false,
      })
    })
    return {
      annotator, gameId: 'G1', quarter: 1,
      sourceFile: `${annotator}.json`, sourceFormat: 'json',
      players: { 1: { name: 'Def One', jersey: '23' } },
      buckets: m,
    }
  }

  const docA = docFor('Alice', wide, [399])
  const docB = docFor('Bob', narrow, [])
  const union = [...new Set([...wide, ...narrow])].sort((x, y) => y - x)
  const shared = makeScale(union)

  it('without a shared scale the two would disagree about the origin', () => {
    // Guards the reasoning behind the fix: the intersection starts at 399,
    // the union at 400, so the unshared scales differ by 1.0s of width.
    const intersection = wide.filter(b => narrow.includes(b))
    expect(makeScale(intersection).xOf(399)).toBe(0)
    expect(makeScale(union).xOf(399)).not.toBe(0)
  })

  it('puts the dead span and the grid run for bucket 399 at the same x', () => {
    const strip = render(<DeadBallStrip docA={docA} docB={docB} scale={shared} />)
    const deadX = leftOf(screen.getByLabelText(/Alice · dead/))
    strip.unmount()

    render(
      <DiffGrid
        report={computeAgreement(docA, docB)}
        docA={docA} docB={docB} scale={shared}
      />,
    )
    const xs = (screen.getAllByLabelText(/·/) as HTMLElement[]).map(leftOf)

    expect(deadX).toBe(shared.xOf(399))
    expect(xs).toContain(deadX)
  })
})

describe('every layer agrees on x for the same bucket', () => {
  // Axis ticks, dead lanes and the defender grid are read as one picture.
  // If any of them derives its own scale, the picture lies.
  const window_ = [400, 399.5, 399, 398.5, 398]

  function docFor(annotator: string, dead: number[]): AnnotationDocument {
    const m = new Map<number, DocumentBucket>()
    window_.forEach((bucket, i) => {
      m.set(bucket, {
        status: dead.includes(bucket) ? 'dead' : 'active',
        defTeam: 'AAA',
        frameStart: i,
        assignments: new Map([[1, 6 as AttackerId]]),
        confidence: new Map(),
        shot: false,
        rebound: false,
      })
    })
    return {
      annotator, gameId: 'G1', quarter: 1,
      sourceFile: `${annotator}.json`, sourceFormat: 'json',
      players: { 1: { name: 'Def One', jersey: '23' } },
      buckets: m,
    }
  }

  const docA = docFor('Alice', [399])
  const docB = docFor('Bob', [])
  const shared = makeScale(window_)
  const TARGET = 399

  it('the axis tick and dead span land on the same x', () => {
    const axis = render(<TimeAxis scale={shared} buckets={window_} />)
    const tickXs = [...axis.container.querySelectorAll('div[style*="position: absolute"]')]
      .map(el => parseFloat((el as HTMLElement).style.left) - LABEL_W)
    axis.unmount()

    const strip = render(<DeadBallStrip docA={docA} docB={docB} scale={shared} />)
    const spanX = leftOf(screen.getByLabelText(/Alice · dead/))
    strip.unmount()

    const expected = shared.xOf(TARGET)
    expect(spanX).toBe(expected)
    // the axis only ticks at round values, so assert it agrees where it does tick
    for (const t of ticks(window_)) {
      expect(tickXs).toContain(shared.xOf(t.bucket))
    }
  })

  it('the defender grid agrees with them', () => {
    render(
      <DiffGrid
        report={computeAgreement(docA, docB)}
        docA={docA} docB={docB} scale={shared}
      />,
    )
    const xs = (screen.getAllByLabelText(/·/) as HTMLElement[]).map(leftOf)
    expect(xs).toContain(shared.xOf(TARGET))
  })
})

describe('narrow disagreements stay identifiable', () => {
  // A one-bucket disagreement is 13px wide — far below the 46px needed for
  // text — so these used to render as mute slivers you had to hover to read.
  const window_ = [400, 399.5, 399, 398.5]

  function docFor(annotator: string, at399: AttackerId): AnnotationDocument {
    const m = new Map<number, DocumentBucket>()
    window_.forEach((bucket, i) => {
      m.set(bucket, {
        status: 'active', defTeam: 'AAA', frameStart: i,
        assignments: new Map([[1, bucket === 399 ? at399 : (6 as AttackerId)]]),
        confidence: new Map(), shot: false, rebound: false,
      })
    })
    return {
      annotator, gameId: 'G1', quarter: 1,
      sourceFile: `${annotator}.json`, sourceFormat: 'json',
      players: {
        1: { name: 'Bell', jersey: '23' },
        6: { name: 'Hall', jersey: '7' },
        7: { name: 'King', jersey: '12' },
      },
      buckets: m,
    }
  }

  const docA = docFor('Alice', 6)
  const docB = docFor('Bob', 7)

  it('splits a too-narrow bar into both annotators colours', () => {
    const { container } = render(
      <DiffGrid report={computeAgreement(docA, docB)} docA={docA} docB={docB} />,
    )
    const fills = [...container.querySelectorAll('span')]
      .map(el => (el as HTMLElement).style.background)
      .filter(Boolean)

    expect(fills.some(f => f.includes('--annot-a'))).toBe(true)
    expect(fills.some(f => f.includes('--annot-b'))).toBe(true)
  })

  it('keeps a narrow bar wide enough to click', () => {
    render(<DiffGrid report={computeAgreement(docA, docB)} docA={docA} docB={docB} />)
    const bar = screen.getByLabelText(/Different attacker/)
    expect(parseFloat(bar.style.width)).toBeGreaterThanOrEqual(6)
  })

  it('still names both answers in the tooltip', () => {
    render(<DiffGrid report={computeAgreement(docA, docB)} docA={docA} docB={docB} />)
    expect(screen.getByLabelText(/Alice:#7 \/ Bob:#12/)).toBeInTheDocument()
  })
})
