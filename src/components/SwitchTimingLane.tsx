import type { AgreementReport } from '../utils/agreement'
import type { AnnotationDocument } from '../utils/annotationDocument'
import { LABEL_W, fmtClock, type TimelineScale } from '../utils/timelineScale'

const ROW_H = 26
const MID = ROW_H / 2

/**
 * When each annotator saw a defender change target.
 *
 * This is the metric the module itself says to trust — carry-forward copies an
 * assignment across most buckets, so any per-bucket rate is inflated by
 * autocorrelation, while switches are the actual decisions. Until now it was a
 * single F1 on a card: you could see that the two disagreed, never where.
 *
 * A's switches point up, B's point down, on the shared clock axis. A matched
 * pair is joined; an unmatched tick is a switch only one annotator recorded.
 */

interface Props {
  report: AgreementReport
  docA: AnnotationDocument
  docB: AnnotationDocument
  scale: TimelineScale
  onJumpToFrame?: (frame: number) => void
}

export default function SwitchTimingLane({ report, docA, docB, scale, onJumpToFrame }: Props) {
  const { byDefender, toleranceBuckets, nA, nB, matched, precision, recall, f1, medianOffsetBuckets } =
    report.switchEvents

  const rows = byDefender.filter(d => d.events.length > 0)
  if (rows.length === 0) return null

  const players = { ...docB.players, ...docA.players }
  const nameA = report.annotatorA || 'A'
  const nameB = report.annotatorB || 'B'

  // Count the switches each side recorded alone. Precision and recall cannot
  // carry this: when one annotator records none at all, matched is 0 and both
  // ratios collapse to 0, hiding the most one-sided case there is.
  const unmatched = { a: 0, b: 0 }
  for (const d of rows) {
    for (const e of d.events) {
      if (e.matchedBucket === null) unmatched[e.side]++
    }
  }
  const lopsided = Math.abs(unmatched.a - unmatched.b) >= 2
    || (Math.max(unmatched.a, unmatched.b) > 0 && Math.min(unmatched.a, unmatched.b) === 0)
  const skew = lopsided && unmatched.a !== unmatched.b
    ? unmatched.a > unmatched.b
      ? `${nameA} records ${unmatched.a} switch(es) ${nameB} does not`
      : `${nameB} records ${unmatched.b} switch(es) ${nameA} does not`
    : null

  return (
    <div style={{
      flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        padding: '6px 12px', fontSize: 11, borderBottom: '1px solid var(--border)',
      }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>Switch timing</strong>
        <span style={{ color: 'var(--text-3)' }}>
          F1 <strong style={{ color: 'var(--text-1)' }}>{f1.toFixed(2)}</strong>
          {' · '}precision {precision.toFixed(2)} / recall {recall.toFixed(2)}
        </span>
        <span style={{ color: 'var(--text-3)' }}>
          {nameA} {nA} · {nameB} {nB} · matched {matched} (±{toleranceBuckets} bucket)
        </span>
        {medianOffsetBuckets !== null && medianOffsetBuckets !== 0 && (
          <span style={{ color: 'var(--text-3)' }}>
            median offset <strong style={{ color: 'var(--text-1)' }}>
              {medianOffsetBuckets > 0 ? '+' : ''}{medianOffsetBuckets.toFixed(1)}
            </strong>{' '}
            bucket ({medianOffsetBuckets > 0 ? nameA : nameB} consistently earlier)
          </span>
        )}
        {skew && <span style={{ color: 'var(--accent-danger)' }}>⚠ {skew}</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>
          ▲ {nameA} · ▼ {nameB} · unjoined = the other missed it
        </span>
      </div>

      <div data-scroll-x style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: LABEL_W + scale.totalW, padding: '4px 0' }}>
          {rows.map(({ defenderId, events }) => {
            const p = players[defenderId]
            return (
              <div key={defenderId} style={{ display: 'flex', height: ROW_H, alignItems: 'center' }}>
                <div style={{
                  width: LABEL_W, flexShrink: 0, padding: '0 10px', height: '100%',
                  position: 'sticky', left: 0, background: 'var(--bg-panel)', zIndex: 3,
                  borderRight: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                }}>
                  <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>
                    #{p?.jersey ?? defenderId}
                  </span>
                  <span style={{
                    color: 'var(--text-3)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p?.name ?? ''}</span>
                </div>

                <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                  {/* Baseline the ticks hang off */}
                  <div style={{
                    position: 'absolute', left: 0, right: 0, top: MID, height: 1,
                    background: 'var(--border-dim)', pointerEvents: 'none',
                  }} />

                  {events.map(e => {
                    const x = scale.xOf(e.bucket)
                    const unmatched = e.matchedBucket === null
                    const who = e.side === 'a' ? nameA : nameB
                    const other = e.side === 'a' ? nameB : nameA
                    const title =
                      `${who} · switch at ${fmtClock(e.bucket)}` +
                      (unmatched
                        ? ` · ${other} did not record one here`
                        : ` · ${other} at ${fmtClock(e.matchedBucket!)}` +
                          ` (${e.offsetBuckets! > 0 ? '+' : ''}${e.offsetBuckets!.toFixed(1)} bucket)`) +
                      (e.frameStart !== undefined ? ' · click to jump' : '')

                    return (
                      <button
                        key={`${e.side}-${e.bucket}`}
                        onClick={() => { if (e.frameStart !== undefined) onJumpToFrame?.(e.frameStart) }}
                        title={title}
                        aria-label={title}
                        style={{
                          position: 'absolute', left: x - 4, width: 8,
                          top: e.side === 'a' ? MID - 10 : MID + 1,
                          height: 10, padding: 0, cursor: 'pointer',
                          background: 'transparent', border: 'none',
                          // Direction encodes who; fill encodes whether it was
                          // matched, so neither depends on colour alone.
                          color: unmatched ? 'var(--accent-danger)' : `var(--annot-${e.side})`,
                          fontSize: 10, lineHeight: '10px',
                        }}
                      >
                        {e.side === 'a' ? (unmatched ? '▲' : '△') : (unmatched ? '▼' : '▽')}
                      </button>
                    )
                  })}

                  {/* Join each matched pair so the offset is visible as a gap */}
                  {events.filter(e => e.side === 'a' && e.matchedBucket !== null).map(e => {
                    const x1 = scale.xOf(e.bucket)
                    const x2 = scale.xOf(e.matchedBucket!)
                    return (
                      <div
                        key={`link-${e.bucket}`}
                        style={{
                          position: 'absolute', top: MID,
                          left: Math.min(x1, x2), width: Math.abs(x2 - x1),
                          height: 2, background: 'var(--text-4)',
                          opacity: 0.8, pointerEvents: 'none',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
