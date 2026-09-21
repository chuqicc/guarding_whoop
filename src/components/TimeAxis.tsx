import { ticks, LABEL_W, type TimelineScale } from '../utils/timelineScale'

const AXIS_H = 20

/**
 * Clock ruler for the compare timelines.
 *
 * Coordinates: this sits in the full-width wrapper alongside the sticky label
 * column, so tick positions need `LABEL_W + xOf(bucket)`. Bars inside a lane's
 * `flex: 1` track do NOT add that offset — mixing the two coordinate systems
 * is a silent 170px shift.
 */
export default function TimeAxis({ scale, buckets }: {
  scale: TimelineScale
  buckets: number[]
}) {
  const marks = ticks(buckets)
  if (marks.length === 0) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        height: AXIS_H,
        width: LABEL_W + scale.totalW,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'sticky', left: 0, zIndex: 3, width: LABEL_W, height: '100%',
        background: 'var(--bg-panel)', borderRight: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 10px',
        fontSize: 10, color: 'var(--text-4)',
      }}>
        game clock
      </div>

      {marks.map(t => (
        <div
          key={t.bucket}
          style={{
            position: 'absolute',
            left: LABEL_W + scale.xOf(t.bucket),
            bottom: 0,
            width: 1,
            height: t.major ? 7 : 4,
            background: t.major ? 'var(--border)' : 'var(--border-dim)',
            pointerEvents: 'none',
          }}
        >
          {t.major && (
            <span style={{
              position: 'absolute', bottom: 8, left: 2,
              fontSize: 10, color: 'var(--text-3)',
              whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
            }}>
              {t.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
