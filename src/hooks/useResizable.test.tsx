import { describe, it, expect } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useResizable, type ResizableOptions } from './useResizable'
import ResizeHandle from '../components/ResizeHandle'

function Harness(opts: ResizableOptions) {
  const r = useResizable(opts)
  return (
    <div>
      <span data-testid="size">{r.size}</span>
      <ResizeHandle resizable={r} label="Resize panel" />
    </div>
  )
}

const size = () => Number(screen.getByTestId('size').textContent)
const handle = () => screen.getByRole('separator')

/** One mouse drag, in px along the handle's axis. */
function drag(delta: number, axis: 'x' | 'y' = 'x') {
  fireEvent.mouseDown(handle(), { clientX: 100, clientY: 100 })
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      clientX: axis === 'x' ? 100 + delta : 100,
      clientY: axis === 'y' ? 100 + delta : 100,
    }))
  })
  act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
}

describe('useResizable', () => {
  it('starts at the initial size', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    expect(size()).toBe(360)
  })

  it('grows when dragged away from the origin', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    drag(+80)
    expect(size()).toBe(440)
  })

  it('shrinks when dragged back', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    drag(-60)
    expect(size()).toBe(300)
  })

  it('inverts for a right-anchored panel, where dragging left must grow it', () => {
    render(<Harness axis="x" initial={280} min={140} max={500} invert />)
    drag(-50)
    expect(size()).toBe(330)
  })

  it('drags along y for a horizontal split', () => {
    render(<Harness axis="y" initial={340} min={150} max={700} />)
    drag(+40, 'y')
    expect(size()).toBe(380)
  })

  it('clamps to min and max', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    drag(-9999)
    expect(size()).toBe(200)
    drag(+9999)
    expect(size()).toBe(900)
  })

  it('stops tracking the mouse after release', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    drag(+40)
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 100 })) })
    expect(size()).toBe(400)
  })
})

describe('keyboard resizing — the hand-rolled dividers had none', () => {
  it('resizes with the arrow keys', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} step={16} />)
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(size()).toBe(376)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(size()).toBe(360)
  })

  it('uses up/down on a horizontal split', () => {
    render(<Harness axis="y" initial={340} min={150} max={700} step={16} />)
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    expect(size()).toBe(356)
  })

  it('respects invert', () => {
    render(<Harness axis="x" initial={280} min={140} max={500} invert step={16} />)
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(size()).toBe(296)
  })

  it('jumps to the limits with Home and End', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    fireEvent.keyDown(handle(), { key: 'Home' })
    expect(size()).toBe(200)
    fireEvent.keyDown(handle(), { key: 'End' })
    expect(size()).toBe(900)
  })

  it('ignores keys it does not own', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    fireEvent.keyDown(handle(), { key: 'a' })
    expect(size()).toBe(360)
  })
})

describe('ResizeHandle accessibility', () => {
  it('is a focusable separator reporting its range', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    const h = handle()
    expect(h).toHaveAttribute('aria-orientation', 'vertical')
    expect(h).toHaveAttribute('aria-valuenow', '360')
    expect(h).toHaveAttribute('aria-valuemin', '200')
    expect(h).toHaveAttribute('aria-valuemax', '900')
    expect(h).toHaveAttribute('tabindex', '0')
    expect(h).toHaveAccessibleName('Resize panel')
  })

  it('reports horizontal orientation for a y-axis split', () => {
    render(<Harness axis="y" initial={340} min={150} max={700} />)
    expect(handle()).toHaveAttribute('aria-orientation', 'horizontal')
  })

  it('keeps aria-valuenow in step with the size', () => {
    render(<Harness axis="x" initial={360} min={200} max={900} />)
    drag(+40)
    expect(handle()).toHaveAttribute('aria-valuenow', '400')
  })
})
