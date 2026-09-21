import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A draggable panel dimension.
 *
 * App.tsx grew three near-identical copies of this drag loop, differing only in
 * axis and sign; the compare and review pages then shipped with fixed sizes
 * because copying it a fourth time was unappealing. One hook instead.
 */
export interface ResizableOptions {
  axis: 'x' | 'y'
  initial: number
  min: number
  max: number
  /** True when dragging toward the origin should GROW the panel (right/bottom-anchored). */
  invert?: boolean
  /** Keyboard step, in px. */
  step?: number
}

export interface Resizable {
  size: number
  setSize: (n: number) => void
  axis: 'x' | 'y'
  min: number
  max: number
  onMouseDown: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export function useResizable({
  axis, initial, min, max, invert = false, step = 16,
}: ResizableOptions): Resizable {
  const [size, setSizeRaw] = useState(initial)
  const drag = useRef<{ start: number; startSize: number } | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  const clamp = useCallback((n: number) => Math.max(min, Math.min(max, n)), [min, max])
  const setSize = useCallback((n: number) => setSizeRaw(clamp(n)), [clamp])

  // A drag that outlives the component would keep writing to dead state.
  useEffect(() => () => { cleanup.current?.() }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const pos = (ev: { clientX: number; clientY: number }) =>
      axis === 'x' ? ev.clientX : ev.clientY
    drag.current = { start: pos(e), startSize: size }

    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return
      const raw = pos(ev) - drag.current.start
      setSizeRaw(clamp(drag.current.startSize + (invert ? -raw : raw)))
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      cleanup.current = null
    }
    cleanup.current = onUp
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [axis, size, invert, clamp])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    let delta = 0
    if (e.key === grow) delta = step
    else if (e.key === shrink) delta = -step
    else if (e.key === 'Home') { e.preventDefault(); setSizeRaw(min); return }
    else if (e.key === 'End') { e.preventDefault(); setSizeRaw(max); return }
    else return

    e.preventDefault()
    setSizeRaw(s => clamp(s + (invert ? -delta : delta)))
  }, [axis, step, invert, clamp, min, max])

  return { size, setSize, axis, min, max, onMouseDown, onKeyDown }
}
