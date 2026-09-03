import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeSet, parseOrQuarantine, isNumberArray, getStorageStatus, subscribeStorageStatus } from './safeStorage'

function quotaError(): DOMException {
  return new DOMException('quota', 'QuotaExceededError')
}

// jsdom's localStorage keys are not enumerable via Object.keys.
function allKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
}

beforeEach(() => {
  localStorage.clear()
  // reset status by performing a successful write
  safeSet('warmup', '1')
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe('safeSet', () => {
  it('writes normally and reports ok', () => {
    expect(safeSet('k', 'v')).toBe(true)
    expect(localStorage.getItem('k')).toBe('v')
    expect(getStorageStatus().state).toBe('ok')
  })

  it('evicts the rebuildable player-CSV cache and retries when the quota is hit', () => {
    localStorage.setItem('pdata_csv', 'big csv')
    localStorage.setItem('pdata_name', 'players.csv')

    const real = localStorage.setItem.bind(localStorage)
    let firstAttempt = true
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === 'annotation_quarter_x' && firstAttempt) { firstAttempt = false; throw quotaError() }
      real(k, v)
    })

    expect(safeSet('annotation_quarter_x', '[1,2,3]')).toBe(true)
    expect(localStorage.getItem('annotation_quarter_x')).toBe('[1,2,3]')
    expect(localStorage.getItem('pdata_csv')).toBeNull()   // evicted to make room
    expect(getStorageStatus().state).toBe('ok')
  })

  it('reports failure instead of throwing when there is nothing left to evict', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })

    const seen: string[] = []
    const unsub = subscribeStorageStatus(s => seen.push(s.state))

    expect(() => safeSet('annotation_quarter_x', 'data')).not.toThrow()
    expect(safeSet('annotation_quarter_x', 'data')).toBe(false)
    expect(getStorageStatus().state).toBe('failed')
    expect(seen).toContain('failed')
    unsub()
  })
})

describe('parseOrQuarantine', () => {
  it('returns parsed values that pass validation', () => {
    localStorage.setItem('nums', '[1,2,3]')
    expect(parseOrQuarantine('nums', isNumberArray)).toEqual([1, 2, 3])
  })

  it('sets aside unparseable data instead of throwing, so the file still loads', () => {
    localStorage.setItem('nums', '{not json')
    expect(parseOrQuarantine('nums', isNumberArray)).toBeNull()
    expect(localStorage.getItem('nums')).toBeNull()
    const quarantined = allKeys().filter(k => k.startsWith('corrupt_nums_'))
    expect(quarantined).toHaveLength(1)
    expect(localStorage.getItem(quarantined[0])).toBe('{not json')
    expect(getStorageStatus().state).toBe('failed')
  })

  it('sets aside data of the wrong shape', () => {
    localStorage.setItem('nums', '{"a":1}')
    expect(parseOrQuarantine('nums', isNumberArray)).toBeNull()
    expect(allKeys().some(k => k.startsWith('corrupt_nums_'))).toBe(true)
  })

  it('returns null for a missing key without flagging a failure', () => {
    safeSet('ok', '1')
    expect(parseOrQuarantine('absent', isNumberArray)).toBeNull()
    expect(getStorageStatus().state).toBe('ok')
  })
})
