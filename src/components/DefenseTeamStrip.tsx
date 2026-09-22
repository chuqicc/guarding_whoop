import { useMemo } from 'react'
import type { AnnotationDocument } from '../utils/annotationDocument'
import { compareDefenseSpans, type DefenseSpan } from '../utils/defenseSpans'
import { makeScale, LABEL_W, LANE_H, fmtClock, type TimelineScale } from '../utils/timelineScale'
import TimeAxis from './TimeAxis'

/**
 * Who was defending, according to each annotator.
 *
 * The most damaging disagreement in the tool: the defending team sets the
 * direction a possession is mirrored into downstream, so one wrong stretch
 * flips a whole possession's frame of reference rather than adding noise to a
 * cell. The page used to report only a count of such buckets, with no way to
 * find them; these lanes show exactly where and what each annotator said.
 *
 * Colour follows the team, matching the court, so a strip reads the same way
 * the animation does. A disagreement is drawn as a hatched overlay rather than
 * a third colour, because the two teams' colours are still the information.
 */

interface Props {
  docA: AnnotationDocument
  docB: AnnotationDocument
  /** Shared with every other lane on the page; see the note on DeadBallStrip. */
  scale?: TimelineScale
  onJumpToFrame?: (frame: number) => void
  /** Rendered above the lanes when this is the only strip on screen. */
  showAxis?: boolean
}

export default function DefenseTeamStrip({
  docA, docB, scale: sharedScale, onJumpToFrame, showAxis = false,
}: Props) {
  const cmp = useMemo(() => compareDefenseSpans(docA, docB), [docA, docB])
  const ownScale = useMemo(() => makeScale(cmp.orderedBuckets), [cmp.orderedBuckets])
  const scale = sharedScale ?? ownScale

  const nameA = docA.annotator || 'A'
  const nameB = docB.annotator || 'B'

  if (cmp.orderedBuckets.length === 0) return null

  // Two teams is the norm; anything beyond that means the files disagree about
  // the fixture itself, which the page guards against upstream.
  const colourFor = (team: string) =>
    cmp.teams.indexOf(team) === 0 ? 'var(--team-a)' : 'var(--team-b)'

  const renderLane = (side: 'a' | 'b', label: string, otherLabel: string) => (
    <div style={{ display: 'flex', height: LANE_H, alignItems: 'center' }}>
      <div style={{
        width: LABEL_W, flexShrink: 0, padding: '0 10px', height: '100%',
        position: 'sticky', left: 0, background: 'var(--bg-panel)', zIndex: 3,
        borderRight: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
      }}>
        <span style={{ color: 'var(--text-3)' }}>{side === 'a' ? 'Defending' : ''}</span>
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
            colour={colourFor(s.team)}
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
    <div style={{
      flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        padding: '6px 12px', fontSize: 11, borderBottom: '1px solid var(--border)',
      }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>Defending team</strong>
        {cmp.teams.map(t => (
          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 11, height: 11, borderRadius: 2, flexShrink: 0,
              background: colourFor(t), border: '1px solid var(--border)',
            }} />
            <span style={{ color: 'var(--text-3)' }}>{t}</span>
          </span>
        ))}
        <span style={{
          color: cmp.counts.disagree > 0 ? 'var(--accent-danger)' : 'var(--text-3)',
        }}>
          {cmp.counts.disagree > 0
            ? `⚠ ${cmp.disagreements.length} stretch(es), ${cmp.counts.disagree} bucket(s) disagree`
            : 'agreed throughout'}
        </span>
        {cmp.counts.missing > 0 && (
          <span style={{ color: 'var(--text-4)' }}>
            {cmp.counts.missing} bucket(s) unlabelled by one side
          </span>
        )}
      </div>

      <div data-scroll-x style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: LABEL_W + scale.totalW }}>
          {showAxis && <TimeAxis scale={scale} buckets={cmp.orderedBuckets} />}
          <div style={{ padding: '4px 0' }}>
            {renderLane('a', nameA, nameB)}
            {renderLane('b', nameB, nameA)}
          </div>
        </div>
      </div>
    </div>
  )
}

function SpanBar({ span, colour, label, otherLabel, x, w, onJump }: {
  span: DefenseSpan
  colour: string
  label: string
  otherLabel: string
  x: number
  w: number
  onJump?: (frame: number) => void
}) {
  const fullyAgreed = span.agreedBuckets === span.bucketCount
  const contested = span.bucketCount - span.agreedBuckets
  const width = Math.max(3, w - 1)

  const title =
    `${label}: ${span.team} defending · ${fmtClock(span.startBucket)} → ${fmtClock(span.endBucket)}` +
    ` · ${span.durationS.toFixed(1)}s` +
    (fullyAgreed
      ? ` · ${otherLabel} agrees`
      : ` · ${otherLabel} names a different team for ${contested} of ${span.bucketCount} bucket(s)`) +
    (span.frameStart !== undefined ? ' · click to jump' : '')

  return (
    <button
      onClick={() => { if (span.frameStart !== undefined) onJump?.(span.frameStart) }}
      title={title}
      aria-label={title}
      style={{
        position: 'absolute', left: x, width, top: 3, height: LANE_H - 6,
        background: colour,
        // Agreed stretches recede; a contested one keeps the team colour (that
        // is the information) and gains a hatch so it stands out without
        // inventing a third hue.
        opacity: fullyAgreed ? 0.45 : 1,
        backgroundImage: fullyAgreed
          ? undefined
          : 'repeating-linear-gradient(45deg, rgba(0,0,0,0.45) 0 3px, transparent 3px 7px)',
        border: `1px solid ${colour}`,
        borderRadius: 2, cursor: 'pointer', padding: 0,
        overflow: 'hidden', color: '#fff', fontSize: 9, whiteSpace: 'nowrap',
      }}
    >
      {width > 34 ? span.team : ''}
    </button>
  )
}
