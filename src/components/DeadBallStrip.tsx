import { useMemo } from 'react'
import type { AnnotationDocument } from '../utils/annotationDocument'
import { compareDeadSpans, type DeadSpan } from '../utils/deadSpans'
import { makeScale, LABEL_W, LANE_H, fmtClock, type TimelineScale } from '../utils/timelineScale'
import TimeAxis from './TimeAxis'

/**
 * Dead-ball agreement as two aligned lanes, A above B.
 *
 * The shape of a dead-ball disagreement is almost never "one of them missed a
 * stoppage entirely" — it is "both saw it, but disagree by a couple of buckets
 * about where it starts". A single per-bucket percentage cannot tell those
 * apart. Two lanes can: aligned blocks agree, staggered edges are a boundary
 * disagreement, a block with nothing opposite it is a missed stoppage.
 */

interface Props {
  docA: AnnotationDocument
  docB: AnnotationDocument
  onJumpToFrame?: (frame: number) => void
  /**
   * Shared horizontal scale. Pass this whenever the lanes sit above another
   * timeline: this component compares the INTERSECTION of the two files'
   * buckets, while DiffGrid renders their UNION, so letting each derive its
   * own scale puts the two origins in different places as soon as one file
   * covers an earlier bucket than the other.
   */
  scale?: TimelineScale
}

export default function DeadBallStrip({ docA, docB, onJumpToFrame, scale: sharedScale }: Props) {
  const cmp = useMemo(() => compareDeadSpans(docA, docB), [docA, docB])
  const ownScale = useMemo(() => makeScale(cmp.orderedBuckets), [cmp.orderedBuckets])
  const scale = sharedScale ?? ownScale

  const nameA = docA.annotator || 'A'
  const nameB = docB.annotator || 'B'
  const { confusion, usage } = cmp
  const disagreeing = confusion.aOnly + confusion.bOnly

  if (cmp.orderedBuckets.length === 0) {
    return null
  }

  const renderLane = (side: 'a' | 'b', label: string, otherLabel: string) => (
    <div style={{ display: 'flex', height: LANE_H, alignItems: 'center' }}>
      <div style={{
        width: LABEL_W, flexShrink: 0, padding: '0 10px', height: '100%',
        position: 'sticky', left: 0, background: 'var(--bg-panel)', zIndex: 3,
        borderRight: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
      }}>
        <span style={{ color: 'var(--text-3)' }}>{side === 'a' ? 'Dead' : ''}</span>
        <span style={{
          color: 'var(--text-1)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
      </div>

      <div style={{ position: 'relative', flex: 1, height: '100%' }}>
        {cmp.spans.filter(s => s.side === side).map(s => (
          <SpanBar
            key={`${side}-${s.startBucket}`}
            span={s}
            side={side}
            label={label}
            otherLabel={otherLabel}
            x={scale.xOf(s.startBucket)}
            w={scale.widthOf(s.durationS)}
            onJump={onJumpToFrame}
          />
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        padding: '6px 12px', fontSize: 11, borderBottom: '1px solid var(--border)',
      }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>Dead ball</strong>
        <span style={{ color: 'var(--text-3)' }}>
          agreed on <strong style={{ color: 'var(--text-1)' }}>{confusion.bothDead}</strong> bucket(s)
        </span>
        <span style={{ color: disagreeing > 0 ? 'var(--accent-danger)' : 'var(--text-3)' }}>
          disagreed on <strong>{disagreeing}</strong>
          {disagreeing > 0 && ` (${nameA} only ${confusion.aOnly} · ${nameB} only ${confusion.bOnly})`}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Swatch side="a" /> <span style={{ color: 'var(--text-3)' }}>{nameA}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Swatch side="b" /> <span style={{ color: 'var(--text-3)' }}>{nameB}</span>
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>
          solid = the other annotator disagreed · faded = both agreed · click to jump
        </span>
      </div>

      {(usage.a === 0 || usage.b === 0) && (
        <div role="alert" style={{
          margin: '6px 12px', padding: '6px 10px', borderRadius: 4, fontSize: 11,
          background: 'var(--bg-surface)', borderLeft: '3px solid var(--confidence-mid, #b8860b)',
          color: 'var(--text-2)',
        }}>
          ⚠ {usage.a === 0 && usage.b === 0
            ? `Neither ${nameA} nor ${nameB} marked any dead ball in this quarter — that is agreement by absence, not by agreement.`
            : `${usage.a === 0 ? nameA : nameB} marked no dead ball at all in this quarter. Check the file actually contains a gamestatus column before reading anything into the agreement figure.`}
        </div>
      )}

      {/* One scroll container so the axis, chart and lanes move together */}
      <div data-scroll-x style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: LABEL_W + scale.totalW }}>
          <TimeAxis scale={scale} buckets={cmp.orderedBuckets} />
          <div style={{ padding: '4px 0' }}>
            {renderLane('a', nameA, nameB)}
            {renderLane('b', nameB, nameA)}
          </div>
        </div>
      </div>
    </div>
  )
}

function SpanBar({ span, side, label, otherLabel, x, w, onJump }: {
  span: DeadSpan
  side: 'a' | 'b'
  label: string
  otherLabel: string
  x: number
  w: number
  onJump?: (frame: number) => void
}) {
  const fullyAgreed = span.agreedBuckets === span.bucketCount
  const notAgreed = span.bucketCount - span.agreedBuckets

  const title =
    `${label} · dead ${fmtClock(span.startBucket)} → ${fmtClock(span.endBucket)} · ${span.durationS.toFixed(1)}s` +
    (fullyAgreed
      ? ` · ${otherLabel} marked all of it too`
      : span.agreedBuckets === 0
        ? ` · ${otherLabel} marked none of it`
        : ` · ${otherLabel} marked ${span.agreedBuckets} of ${span.bucketCount} bucket(s), ${notAgreed} not shared`) +
    (span.frameStart !== undefined ? ` · click to jump to frame ${span.frameStart}` : '')

  return (
    <button
      onClick={() => { if (span.frameStart !== undefined) onJump?.(span.frameStart) }}
      title={title}
      aria-label={title}
      style={{
        position: 'absolute', left: x, width: Math.max(3, w - 1),
        top: 3, height: LANE_H - 6,
        // Hue says WHO; intensity says whether the other annotator agreed.
        // Keeping the two on separate channels means a reader can still pick
        // out the contested stretches without decoding the colours.
        background: `var(--annot-${side})`,
        opacity: fullyAgreed ? 0.4 : 1,
        border: `1px solid var(--annot-${side})`,
        borderRadius: 2, cursor: 'pointer', padding: 0,
      }}
    />
  )
}

function Swatch({ side }: { side: 'a' | 'b' }) {
  return (
    <span style={{
      width: 11, height: 11, borderRadius: 2, flexShrink: 0,
      background: `var(--annot-${side})`, border: '1px solid var(--border)',
    }} />
  )
}
