import { describe, it, expect } from 'vitest'
import { buildAgreementReportHTML, methodsParagraph, type ReportInput } from './agreementReport'
import { computeAgreement } from './agreement'
import { compareDeadSpans } from './deadSpans'
import { compareDefenseSpans } from './defenseSpans'
import type { AnnotationDocument, DocumentBucket } from './annotationDocument'
import type { AttackerId } from '../store/useStore'

const WINDOW = [400, 399.5, 399, 398.5, 398]

interface Spec {
  dead?: boolean
  team?: string
  assignments?: Record<number, AttackerId>
}

function doc(annotator: string, per: Record<string, Spec>): AnnotationDocument {
  const buckets = new Map<number, DocumentBucket>()
  WINDOW.forEach((bucket, i) => {
    const s = per[String(bucket)] ?? {}
    buckets.set(bucket, {
      status: s.dead ? 'dead' : 'active',
      defTeam: s.team ?? 'AAA',
      frameStart: i,
      assignments: new Map(Object.entries(s.assignments ?? { 1: 6 }).map(([d, a]) => [Number(d), a])),
      confidence: new Map(),
      shot: false, rebound: false,
    })
  })
  return {
    annotator, gameId: 'G1', quarter: 3,
    sourceFile: `${annotator}.json`, sourceFormat: 'json',
    players: { 1: { name: 'Bell', jersey: '23' } },
    buckets,
  }
}

const spread = (over: Record<string, Spec> = {}) => {
  const out: Record<string, Spec> = {}
  for (const b of WINDOW) out[String(b)] = {}
  return { ...out, ...over }
}

function input(docA: AnnotationDocument, docB: AnnotationDocument): ReportInput {
  return {
    report: computeAgreement(docA, docB),
    docA, docB,
    dead: compareDeadSpans(docA, docB),
    defense: compareDefenseSpans(docA, docB),
  }
}

const basic = () => input(doc('Alice', spread()), doc('Bob', spread()))

describe('buildAgreementReportHTML', () => {
  it('is a complete standalone document', () => {
    const html = buildAgreementReportHTML(basic())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    // No external requests: it has to survive being emailed.
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('names both annotators and the fixture', () => {
    const html = buildAgreementReportHTML(basic())
    expect(html).toContain('Alice')
    expect(html).toContain('Bob')
    expect(html).toContain('G1')
    expect(html).toContain('Q3')
  })

  it('leads with the switch-event figure, not the inflated one', () => {
    const html = buildAgreementReportHTML(basic())
    expect(html.indexOf('Switch-event F1')).toBeLessThan(html.indexOf('Raw agreement'))
  })

  it('says the raw figure is inflated, right beside it', () => {
    expect(buildAgreementReportHTML(basic())).toContain('inflated by carry-forward')
  })

  it('prints every exclusion count', () => {
    const html = buildAgreementReportHTML(basic())
    expect(html).toContain('Only one annotator filled it in')
    expect(html).toContain('In a bucket either called dead')
    expect(html).toContain('named different defending teams')
  })

  it('carries all the limitations, not a collapsed count', () => {
    const { report } = basic()
    const html = buildAgreementReportHTML(basic())
    for (const c of report.caveats) {
      // Caveats are escaped in the output, so compare on a distinctive fragment.
      expect(html).toContain(c.slice(0, 40).replace(/&/g, '&amp;'))
    }
  })

  it('lists defending-team disagreements with both answers', () => {
    const html = buildAgreementReportHTML(input(
      doc('Alice', spread({ '399': { team: 'BBB' } })),
      doc('Bob', spread()),
    ))
    expect(html).toContain('Alice: BBB')
    expect(html).toContain('Bob: AAA')
  })

  it('lists dead-ball disagreements with who called what', () => {
    const html = buildAgreementReportHTML(input(
      doc('Alice', spread({ '399': { dead: true } })),
      doc('Bob', spread()),
    ))
    expect(html).toContain('Alice called it dead')
    expect(html).toContain('Bob called it live')
  })

  it('says so plainly when a category has no disagreements', () => {
    expect(buildAgreementReportHTML(basic())).toContain('The two agreed throughout.')
  })

  it('includes the per-defender table', () => {
    const html = buildAgreementReportHTML(basic())
    expect(html).toContain('By defender')
    expect(html).toContain('#23 Bell')
  })

  it('escapes annotator names so a stray angle bracket cannot break the page', () => {
    const html = buildAgreementReportHTML(input(
      doc('<script>x</script>', spread()),
      doc('Bob', spread()),
    ))
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('writes an em dash for an undefined κ rather than a zero', () => {
    // Both annotators only ever used one category here.
    const html = buildAgreementReportHTML(basic())
    expect(html).toContain('—')
    expect(html).not.toMatch(/Cohen's κ[\s\S]{0,120}>0\.00</)
  })
})

describe('methodsParagraph', () => {
  it('states the switch-event figure before the per-bucket one', () => {
    const p = methodsParagraph(basic())
    expect(p.indexOf('switch events')).toBeLessThan(p.indexOf('Agreement on whether play was live'))
  })

  it('explains why the per-bucket figure is inflated', () => {
    expect(methodsParagraph(basic())).toContain('autocorrelated')
  })

  it('quotes the denominators, not just the rates', () => {
    const p = methodsParagraph(basic())
    expect(p).toMatch(/n = \d+/)
  })

  it('reports the tolerance in both buckets and seconds', () => {
    expect(methodsParagraph(basic())).toMatch(/±2 buckets \(±1\.0 s\)/)
  })

  it('names who was earlier when there is a systematic offset', () => {
    // Alice switches one bucket before Bob, every time.
    const a = doc('Alice', spread({
      '399': { assignments: { 1: 7 } }, '398.5': { assignments: { 1: 7 } },
      '398': { assignments: { 1: 7 } },
    }))
    const b = doc('Bob', spread({
      '398.5': { assignments: { 1: 7 } }, '398': { assignments: { 1: 7 } },
    }))
    const p = methodsParagraph(input(a, b))
    expect(p).toMatch(/median timing offset|Median offset/i)
  })

  it('reports the excluded counts, which a reviewer will ask for', () => {
    const p = methodsParagraph(basic())
    expect(p).toMatch(/excluded from the\s+assignment figures/)
  })
})
