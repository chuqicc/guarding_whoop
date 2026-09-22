import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseAnnotationDocument, UnsupportedAnnotationFile, type AnnotationDocument } from '../utils/annotationDocument'
import { computeAgreement } from '../utils/agreement'
import { csvRow, download } from '../utils/export'
import { buildAgreementReportHTML } from '../utils/agreementReport'
import { compareDeadSpans } from '../utils/deadSpans'
import { compareDefenseSpans } from '../utils/defenseSpans'
import { useStore } from '../store/useStore'
import { isEditableTarget } from '../utils/isEditableTarget'
import DiffGrid from '../components/DiffGrid'
import DeadBallStrip from '../components/DeadBallStrip'
import DefenseTeamStrip from '../components/DefenseTeamStrip'
import SwitchTimingLane from '../components/SwitchTimingLane'
import PerDefenderTable from '../components/PerDefenderTable'
import DisagreementQueue from '../components/DisagreementQueue'
import AnnotationDropZone from '../components/AnnotationDropZone'
import TrackingDropZone, { type LoadedTracking } from '../components/TrackingDropZone'
import { parseQuarterJSON } from '../utils/parseQuarterJSON'
import { buildDiffRuns, isReviewable, type DiffRun } from '../utils/diffRuns'
import { makeScale } from '../utils/timelineScale'
import type { AttackerId } from '../store/useStore'

type Side = 'a' | 'b'

interface Props {
  onBack: () => void
  /** Lifted to App so the review page can reuse them without re-dropping files. */
  docA: AnnotationDocument | null
  docB: AnnotationDocument | null
  setDocA: (d: AnnotationDocument | null) => void
  setDocB: (d: AnnotationDocument | null) => void
  tracking: LoadedTracking | null
  setTracking: (t: LoadedTracking | null) => void
  videoUrl: string | null
  setVideoFile: (f: File | null) => void
  onReviewDeadBalls: () => void
}

export default function ComparePage({
  onBack, docA, docB, setDocA, setDocB,
  tracking, setTracking, videoUrl, setVideoFile, onReviewDeadBalls,
}: Props) {
  const [errTracking, setErrTracking] = useState<string | null>(null)
  const [errA, setErrA] = useState<string | null>(null)
  const [errB, setErrB] = useState<string | null>(null)
  const [selected, setSelected] = useState<DiffRun | null>(null)
  // Most disagreements are a bucket or two long — far too narrow to read on a
  // timeline — so the list is the default place to work through them.
  const [bottomView, setBottomView] = useState<'list' | 'timeline'>('list')

  const setCurrentFrame = useStore(s => s.setCurrentFrame)
  const framesLoaded = useStore(s => s.frames.length > 0)

  const load = async (side: Side, file: File) => {
    const setDoc = side === 'a' ? setDocA : setDocB
    const setErr = side === 'a' ? setErrA : setErrB
    try {
      const doc = parseAnnotationDocument(await file.text(), file.name)
      setDoc(doc)
      setErr(null)
    } catch (e) {
      setDoc(null)
      setErr(e instanceof UnsupportedAnnotationFile ? e.message : `Could not read this file: ${String(e)}`)
    }
  }

  const loadTracking = async (file: File) => {
    try {
      // parseQuarterJSON is pure. Deliberately NOT the store's loadQuarter,
      // which clears cellAnnotations and resets undo — that would wipe the
      // work of whoever has a quarter open on the annotate page.
      const parsed = parseQuarterJSON(await file.text(), file.name)
      setTracking({ filename: file.name, ...parsed })
      setErrTracking(null)
    } catch (e) {
      setTracking(null)
      setErrTracking(`Could not read this tracking file: ${String(e)}`)
    }
  }

  // Tracking that is not the annotated quarter would illustrate the wrong play.
  const trackingMismatch = useMemo(() => {
    if (!tracking || !docA) return null
    const m = tracking.quarterMeta
    if (m.gameId !== docA.gameId || m.quarter !== docA.quarter) {
      return `Tracking file is ${m.gameId} Q${m.quarter}, annotations are ${docA.gameId} Q${docA.quarter}`
    }
    return null
  }, [tracking, docA])

  // Comparing different quarters produces numbers that look fine and mean
  // nothing, so it is refused rather than warned about.
  const mismatch = useMemo(() => {
    if (!docA || !docB) return null
    if (docA.gameId !== docB.gameId) return `These files are from different games (${docA.gameId} vs ${docB.gameId})`
    if (docA.quarter !== docB.quarter) return `These files are from different quarters (Q${docA.quarter} vs Q${docB.quarter})`
    return null
  }, [docA, docB])

  const report = useMemo(
    () => (docA && docB && !mismatch ? computeAgreement(docA, docB) : null),
    [docA, docB, mismatch],
  )

  // One bucket list and one scale for every lane on this page. The strip
  // compares the intersection and the grid renders the union, so deriving the
  // scale separately would misalign them whenever the two files differ in span.
  const orderedBuckets = useMemo(
    () => (docA && docB
      ? [...new Set([...docA.buckets.keys(), ...docB.buckets.keys()])].sort((x, y) => y - x)
      : []),
    [docA, docB],
  )
  const scale = useMemo(() => makeScale(orderedBuckets), [orderedBuckets])

  const runs = useMemo(
    () => (report ? buildDiffRuns(report.cells, orderedBuckets) : []),
    [report, orderedBuckets],
  )

  const reviewable = useMemo(() => runs.filter(r => isReviewable(r.status)), [runs])

  const jumpTo = useCallback((run: DiffRun) => {
    setSelected(run)
    const frame = docA?.buckets.get(run.startBucket)?.frameStart
      ?? docB?.buckets.get(run.startBucket)?.frameStart
    if (frame !== undefined && framesLoaded) setCurrentFrame(frame)
  }, [docA, docB, framesLoaded, setCurrentFrame])

  const step = useCallback((delta: number) => {
    if (reviewable.length === 0) return
    const i = selected ? reviewable.findIndex(
      r => r.defenderId === selected.defenderId && r.startBucket === selected.startBucket,
    ) : -1
    const next = (i + delta + reviewable.length) % reviewable.length
    jumpTo(reviewable[next])
  }, [reviewable, selected, jumpTo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.key === 'n') { e.preventDefault(); step(1) }
      if (e.key === 'p') { e.preventDefault(); step(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const nameOf = (doc: AnnotationDocument | null, id: AttackerId | undefined) => {
    if (id === undefined) return ''
    if (id === 'GUARD_NONE') return 'GUARD_NONE'
    return doc?.players[id as number]?.jersey ? `#${doc.players[id as number].jersey}` : String(id)
  }

  const exportHTML = () => {
    if (!report || !docA || !docB) return
    const html = buildAgreementReportHTML({
      report, docA, docB,
      dead: compareDeadSpans(docA, docB),
      defense: compareDefenseSpans(docA, docB),
    })
    download(html, `agreement_${report.gameId}_Q${report.quarter}.html`, 'text/html')
  }

  const exportReport = () => {
    if (!report) return
    const header = csvRow([
      'game_id', 'quarter', 'annotator_a', 'annotator_b',
      'defender_id', 'defender_jersey', 'status',
      'start_bucket', 'end_bucket', 'duration_s', 'frame_start',
      'answer_a', 'answer_b',
    ])
    const rows = reviewable.map(r => csvRow([
      report.gameId, report.quarter, report.annotatorA, report.annotatorB,
      r.defenderId, docA?.players[r.defenderId]?.jersey ?? '', r.status,
      r.startBucket, r.endBucket, r.durationS,
      docA?.buckets.get(r.startBucket)?.frameStart ?? '',
      nameOf(docA, r.a), nameOf(docB, r.b),
    ]))
    download(
      [header, ...rows].join('\n'),
      `agreement_${report.gameId}_Q${report.quarter}.csv`,
      'text/csv',
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-page)', color: 'var(--text-1)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)',
      }}>
        <button onClick={onBack} style={btn()}>← Back</button>
        <strong style={{ fontSize: 14 }}>Compare Annotators</strong>
        {report && (
          <>
            <button
              onClick={onReviewDeadBalls}
              disabled={!tracking || !!trackingMismatch}
              title={!tracking
                ? 'Load the quarter tracking JSON to review disagreements on the court'
                : trackingMismatch ?? ''}
              style={{ ...btn(), marginLeft: 'auto', opacity: tracking && !trackingMismatch ? 1 : 0.5 }}
            >
              Review disagreements →
            </button>
            <button onClick={exportHTML} style={btn()}>
              ⬇ Reliability report
            </button>
            <button onClick={exportReport} style={btn()}>
              ⬇ Disagreements CSV
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '12px 12px 0', flexShrink: 0 }}>
        <AnnotationDropZone label="Annotator A" doc={docA} error={errA} onFile={f => load('a', f)} />
        <AnnotationDropZone label="Annotator B" doc={docB} error={errB} onFile={f => load('b', f)} />
      </div>

      <div style={{ display: 'flex', gap: 12, padding: 12, flexShrink: 0 }}>
        <TrackingDropZone
          label="Tracking data (for the review view)"
          hint="Drop the quarter tracking JSON"
          accept=".json"
          loaded={tracking && `${tracking.quarterMeta.gameId} Q${tracking.quarterMeta.quarter} · ${tracking.frames.length} frames`}
          error={errTracking}
          onFile={loadTracking}
        />
        <TrackingDropZone
          label="Game footage (optional)"
          hint="Drop a video file"
          accept="video/*"
          loaded={videoUrl ? 'Video loaded' : null}
          error={null}
          onFile={f => setVideoFile(f)}
        />
      </div>

      {trackingMismatch && (
        <div role="alert" style={banner('var(--accent-danger)')}>
          ⚠ {trackingMismatch} — the review view would show the wrong play.
        </div>
      )}

      {mismatch && (
        <div role="alert" style={banner('var(--accent-danger)')}>
          ⚠ {mismatch} — refusing to compare, because the resulting figures would be meaningless.
        </div>
      )}

      {report && report.annotatorA && report.annotatorA === report.annotatorB && (
        <div role="alert" style={banner('var(--confidence-mid)')}>
          ⚠ Both files name the same annotator ({report.annotatorA}), so the two sides cannot be told apart. Check you did not load the same file twice.
        </div>
      )}

      {report && report.nDefenseMismatch > 0 && (
        <div role="alert" style={banner('#7b3fa0')}>
          ⚠ The two annotators disagree about which team was defending in{' '}
          {report.defenseMismatchBuckets.length} bucket(s), excluding {report.nDefenseMismatch} cell(s).
          This is a possession-level disagreement, not a cell-level one — see the
          defending-team lanes below to find them.
        </div>
      )}

      {report && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0 12px 10px' }}>
            {/* Ordered by how much the numbers can be trusted. The switch-event
                F1 leads because carry-forward inflates every per-bucket rate;
                the old order put the most inflated figure first. */}
            <Card
              value={report.switchEvents.f1.toFixed(2)}
              label="Switch-event F1"
              sub={`±${report.switchEvents.toleranceBuckets} bucket · precision ${
                report.switchEvents.precision.toFixed(2)} / recall ${
                report.switchEvents.recall.toFixed(2)}`}
              emphasis
            />
            <Card
              value={`${(report.deadLive.agreement * 100).toFixed(1)}%`}
              label="Dead-ball agreement"
              sub={`n = ${report.deadLive.nCompared} buckets · κ ${
                report.deadLive.kappa === null ? '—' : report.deadLive.kappa.toFixed(2)
              }`}
            />
            <Card
              value={report.kappaPooled === null ? '—' : report.kappaPooled.toFixed(2)}
              label="Cohen's κ (pooled)"
              sub={report.kappaPooled === null
                ? 'Only one category used — κ is undefined'
                : `mean per defender ${report.kappaMeanPerDefender?.toFixed(2) ?? '—'}`}
            />
            <Card
              value={`${(report.rawAgreement * 100).toFixed(1)}%`}
              label="Raw agreement"
              sub={`n = ${report.nCompared} · inflated by carry-forward`}
            />
            <Card value={String(report.nCoverageMismatch)} label="Only one annotated" sub="excluded from κ" muted />
            <Card
              value={String(report.nDeadExcluded)}
              label="Cells in dead buckets"
              sub="excluded from assignments"
              muted
            />
            <Card value={String(report.nDefenseMismatch)} label="Defending team differs" sub="excluded" muted />
          </div>

          <div style={{ padding: '0 12px 10px', fontSize: 12, color: 'var(--text-3)' }}>
            <strong style={{ color: 'var(--text-2)' }}>
              How to read these numbers
            </strong>
            {/* Not collapsed: one of these caveats says the cleanest metric is
                unavailable, and hiding that makes the headline figure look
                better than it is. */}
            <ul style={{ margin: '6px 0 0 18px', lineHeight: 1.6 }}>
              {report.caveats.map((c, i) => <li key={i}>{c}</li>)}
            </ul>

            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}>
                Marginals ({report.marginals.length} categories) — how much room chance had
              </summary>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, marginTop: 6 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 10px 3px 0' }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '3px 10px' }}>
                      {report.annotatorA || 'A'}
                    </th>
                    <th style={{ textAlign: 'right', padding: '3px 10px' }}>
                      {report.annotatorB || 'B'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.marginals.map(m => (
                    <tr key={m.category} style={{ borderBottom: '1px solid var(--border-dim)' }}>
                      <td style={{ padding: '2px 10px 2px 0' }}>{m.category}</td>
                      <td style={{ padding: '2px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.aCount}</td>
                      <td style={{ padding: '2px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.bCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 12,
          }}>
            <button onClick={() => step(-1)} style={btn()}>← p Previous</button>
            <button onClick={() => step(1)} style={btn()}>n Next →</button>
            <span style={{ color: 'var(--text-3)' }}>
              {reviewable.length} to review
              {selected && ` · at #${docA?.players[selected.defenderId]?.jersey ?? selected.defenderId}, clock ${selected.startBucket.toFixed(1)}`}
            </span>
            {!framesLoaded && (
              <span style={{ color: 'var(--text-4)', marginLeft: 'auto' }}>
                (no tracking data loaded — clicking a bar cannot jump to playback)
              </span>
            )}
          </div>

          <PerDefenderTable report={report} docA={docA!} docB={docB!} />

          <DefenseTeamStrip
            docA={docA!} docB={docB!} scale={scale}
            onJumpToFrame={f => { if (framesLoaded) setCurrentFrame(f) }}
          />

          <SwitchTimingLane
            report={report} docA={docA!} docB={docB!} scale={scale}
            onJumpToFrame={f => { if (framesLoaded) setCurrentFrame(f) }}
          />

          <DeadBallStrip
            docA={docA!} docB={docB!} scale={scale}
            onJumpToFrame={f => { if (framesLoaded) setCurrentFrame(f) }}
          />

          <div style={{
            display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0,
            padding: '4px 12px', borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)',
          }}>
            {([['list', '☰ List'], ['timeline', '▦ Timeline']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setBottomView(v)}
                aria-pressed={bottomView === v}
                style={{
                  background: bottomView === v ? 'var(--bg-col-active)' : 'transparent',
                  color: bottomView === v ? 'var(--text-1)' : 'var(--text-3)',
                  border: `1px solid ${bottomView === v ? 'var(--border)' : 'transparent'}`,
                  borderRadius: 4, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0 }}>
            {bottomView === 'list' ? (
              <DisagreementQueue
                runs={reviewable} docA={docA!} docB={docB!}
                annotatorA={report.annotatorA || 'A'}
                annotatorB={report.annotatorB || 'B'}
                selected={selected} onSelect={jumpTo}
              />
            ) : (
              <DiffGrid
                report={report} docA={docA!} docB={docB!} scale={scale}
                selectedRun={selected} onSelectRun={jumpTo}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Card({ value, label, sub, muted, emphasis }: {
  value: string; label: string; sub?: string; muted?: boolean; emphasis?: boolean
}) {
  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: `1px solid ${emphasis ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 6, padding: '8px 12px', minWidth: 132,
      opacity: muted ? 0.75 : 1,
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: muted ? 'var(--text-2)' : 'var(--text-1)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const btn = (): React.CSSProperties => ({
  background: 'var(--bg-surface)', color: 'var(--text-1)',
  border: '1px solid var(--border)', borderRadius: 4,
  padding: '3px 10px', fontSize: 12, cursor: 'pointer',
})

const banner = (color: string): React.CSSProperties => ({
  margin: '0 12px 10px', padding: '7px 12px', borderRadius: 5,
  background: 'var(--bg-panel)', borderLeft: `3px solid ${color}`,
  fontSize: 12, color: 'var(--text-2)',
})
