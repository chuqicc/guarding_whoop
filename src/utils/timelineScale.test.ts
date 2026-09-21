import { describe, it, expect } from 'vitest'
import { makeScale, ticks, fmtClock, fmtClockShort, LABEL_W, PX_PER_S } from './timelineScale'

// Descending, as the quarter clock counts down.
const buckets = [400, 399.5, 399, 398.5, 398]

describe('makeScale', () => {
  it('keeps the constants the grid was already using', () => {
    // These are load-bearing: the dead-ball lanes must land on the same x as
    // the defender rows, so extracting them must not change the numbers.
    expect(LABEL_W).toBe(170)
    expect(PX_PER_S).toBe(26)
  })

  it('puts the first bucket at x = 0', () => {
    expect(makeScale(buckets).xOf(400)).toBe(0)
  })

  it('advances one bucket by half a second of width', () => {
    const s = makeScale(buckets)
    expect(s.xOf(399.5)).toBe(0.5 * PX_PER_S)
    expect(s.xOf(399)).toBe(1.0 * PX_PER_S)
  })

  it('derives position from the clock, not the array index', () => {
    // 399.5 is missing from the data; 399 must still land where 1.0s belongs,
    // otherwise a gap in tracking would silently compress the timeline.
    const gapped = [400, 399, 398.5]
    expect(makeScale(gapped).xOf(399)).toBe(1.0 * PX_PER_S)
  })

  it('reproduces the grid formula exactly', () => {
    const s = makeScale(buckets)
    const firstBucket = buckets[0]
    for (const b of buckets) {
      expect(s.xOf(b)).toBe((firstBucket - b) * PX_PER_S)
    }
  })

  it('converts a duration to a width', () => {
    expect(makeScale(buckets).widthOf(1.5)).toBe(1.5 * PX_PER_S)
  })

  it('sizes the lane from the clock span', () => {
    // For contiguous buckets the span and the count agree, which is why the
    // count-based version went unnoticed.
    const many = Array.from({ length: 100 }, (_, i) => 400 - i * 0.5)
    expect(makeScale(many).totalW).toBe(50 * PX_PER_S)   // 400 -> 350.5, +1 bucket
  })

  it('covers the full span when the tracking data has holes', () => {
    // The old count-based width left the rightmost bars painted beyond the
    // declared width, so the scroll range stopped short and they could not be
    // reached at all. Any axis drawn on a count basis would drift from the
    // bars by the same accumulated gap.
    const gapped = Array.from({ length: 100 }, (_, i) => 400 - i)   // 1s apart, not 0.5
    const s = makeScale(gapped)
    const rightmost = s.xOf(gapped[gapped.length - 1])

    expect(rightmost).toBeLessThanOrEqual(s.totalW)
    expect(s.totalW).toBe((400 - 301 + 0.5) * PX_PER_S)
  })

  it('applies a minimum width so a tiny file still renders', () => {
    expect(makeScale(buckets).totalW).toBe(240)     // 5 buckets = 65px, floored
    expect(makeScale([]).totalW).toBe(240)
  })

  it('does not throw on an empty bucket list', () => {
    expect(makeScale([]).xOf(400)).toBe(-400 * PX_PER_S)
  })
})

describe('fmtClock', () => {
  it('formats seconds-remaining as mm:ss.s', () => {
    expect(fmtClock(400)).toBe('6:40.0')
    expect(fmtClock(399.5)).toBe('6:39.5')
    expect(fmtClock(5)).toBe('0:05.0')
  })

  it('drops the tenth for axis labels', () => {
    expect(fmtClockShort(400)).toBe('6:40')
    expect(fmtClockShort(399.5)).toBe('6:40')   // rounded
    expect(fmtClockShort(5)).toBe('0:05')
  })

  it('never prints a :60 second', () => {
    // 359.7 rounds to 60 within the minute; it must roll over.
    expect(fmtClockShort(359.7)).toBe('6:00')
  })
})

describe('ticks', () => {
  const quarter = Array.from({ length: 200 }, (_, i) => 400 - i * 0.5)   // 400 -> 300.5

  it('returns nothing for an empty timeline', () => {
    expect(ticks([])).toEqual([])
  })

  it('handles a single bucket without looping forever', () => {
    expect(ticks([400])).toEqual([{ bucket: 400, label: '6:40', major: true }])
  })

  it('spaces major ticks near the requested pixel gap', () => {
    const majors = ticks(quarter, 160).filter(t => t.major)
    const gaps = majors.slice(1).map((t, i) => (majors[i].bucket - t.bucket) * PX_PER_S)
    for (const g of gaps) {
      expect(g).toBeGreaterThan(80)
      expect(g).toBeLessThan(320)
    }
  })

  it('puts labels only on majors', () => {
    const all = ticks(quarter)
    expect(all.filter(t => t.major).every(t => t.label.length > 0)).toBe(true)
    expect(all.filter(t => !t.major).every(t => t.label === '')).toBe(true)
  })

  it('keeps every tick inside the data range', () => {
    const all = ticks(quarter)
    const first = quarter[0]
    const last = quarter[quarter.length - 1]
    for (const t of all) {
      expect(t.bucket).toBeLessThanOrEqual(first)
      expect(t.bucket).toBeGreaterThanOrEqual(last - 1e-9)
    }
  })

  it('lands on round clock values, not on whichever bucket came first', () => {
    // Starting at 399.3 must still tick at 395, 390, ... so the labels read well.
    const odd = Array.from({ length: 60 }, (_, i) => 399.3 - i * 0.5)
    const majors = ticks(odd).filter(t => t.major)
    expect(majors.length).toBeGreaterThan(0)
    for (const t of majors) {
      expect(Number.isInteger(t.bucket)).toBe(true)
    }
  })

  it('does not drift from the bars when the data has holes', () => {
    const gapped = Array.from({ length: 60 }, (_, i) => 400 - i)
    const s = makeScale(gapped)
    for (const t of ticks(gapped)) {
      expect(s.xOf(t.bucket)).toBeLessThanOrEqual(s.totalW)
      expect(s.xOf(t.bucket)).toBeGreaterThanOrEqual(0)
    }
  })
})
