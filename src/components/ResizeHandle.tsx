import type { Resizable } from '../hooks/useResizable'

/**
 * The grab strip between two panels.
 *
 * Exposed as a real `separator` with arrow-key support: the three hand-rolled
 * dividers this replaces were bare `div`s with a mousedown handler, so panels
 * could not be resized without a mouse at all.
 */
export default function ResizeHandle({ resizable, label }: {
  resizable: Resizable
  label: string
}) {
  const vertical = resizable.axis === 'x'   // a vertical bar moves along x

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(resizable.size)}
      aria-valuemin={resizable.min}
      aria-valuemax={resizable.max}
      tabIndex={0}
      onMouseDown={resizable.onMouseDown}
      onKeyDown={resizable.onKeyDown}
      title={`${label} — drag, or focus and use the arrow keys`}
      style={{
        flexShrink: 0,
        width: vertical ? 6 : '100%',
        height: vertical ? '100%' : 6,
        background: 'var(--bg-surface)',
        borderLeft: vertical ? '1px solid var(--border)' : undefined,
        borderRight: vertical ? '1px solid var(--border)' : undefined,
        borderTop: vertical ? undefined : '1px solid var(--border)',
        borderBottom: vertical ? undefined : '1px solid var(--border)',
        cursor: vertical ? 'col-resize' : 'row-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        userSelect: 'none', zIndex: 10,
      }}
    >
      <span style={{
        color: 'var(--divider-fg)', fontSize: 10, letterSpacing: vertical ? 0 : 4,
        writingMode: vertical ? 'vertical-rl' : undefined,
        pointerEvents: 'none',
      }}>⠿</span>
    </div>
  )
}
