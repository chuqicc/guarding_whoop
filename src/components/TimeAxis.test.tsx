import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TimeAxis from './TimeAxis'
import { makeScale, ticks, LABEL_W } from '../utils/timelineScale'

const quarter = Array.from({ length: 200 }, (_, i) => 400 - i * 0.5)

const tickEls = (c: HTMLElement) =>
  [...c.querySelectorAll('div[style*="position: absolute"]')] as HTMLElement[]

describe('TimeAxis', () => {
  it('renders nothing without data', () => {
    const { container } = render(<TimeAxis scale={makeScale([])} buckets={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('places ticks at LABEL_W + xOf — the full-width coordinate system', () => {
    // Bars inside a lane track omit LABEL_W; the axis is a sibling of the
    // sticky label column and must include it. Mixing the two shifts by 170px.
    const scale = makeScale(quarter)
    const { container } = render(<TimeAxis scale={scale} buckets={quarter} />)

    const expected = ticks(quarter).map(t => LABEL_W + scale.xOf(t.bucket))
    const actual = tickEls(container).map(el => parseFloat(el.style.left))
    expect(actual).toEqual(expected)
  })

  it('labels majors as m:ss and leaves minors bare', () => {
    const { container } = render(<TimeAxis scale={makeScale(quarter)} buckets={quarter} />)
    const labels = [...container.querySelectorAll('span')]
      .map(s => s.textContent ?? '')
      .filter(t => /^\d+:\d\d$/.test(t))

    expect(labels.length).toBeGreaterThan(0)
    // no tenths on the axis
    expect(labels.every(t => !t.includes('.'))).toBe(true)
  })

  it('keeps every tick inside the declared width, including gapped data', () => {
    // The count-based totalW used to fall short of the clock span here.
    const gapped = Array.from({ length: 60 }, (_, i) => 400 - i)
    const scale = makeScale(gapped)
    const { container } = render(<TimeAxis scale={scale} buckets={gapped} />)

    for (const el of tickEls(container)) {
      const left = parseFloat(el.style.left)
      expect(left).toBeGreaterThanOrEqual(LABEL_W)
      expect(left).toBeLessThanOrEqual(LABEL_W + scale.totalW)
    }
  })

  it('is hidden from assistive tech — the bars carry the labels', () => {
    const { container } = render(<TimeAxis scale={makeScale(quarter)} buckets={quarter} />)
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})
