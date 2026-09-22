import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnloadGuard } from './useUnloadGuard'

const realUA = navigator.userAgent

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

/** Dispatch beforeunload and report whether something tried to block it. */
function leavePage(): boolean {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

beforeEach(() => setUserAgent('Mozilla/5.0 Chrome/120 Safari/537.36'))
afterEach(() => {
  setUserAgent(realUA)
  vi.restoreAllMocks()
})

describe('useUnloadGuard', () => {
  it('warns before leaving when there is loaded work', () => {
    renderHook(() => useUnloadGuard(true))
    expect(leavePage()).toBe(true)
  })

  it('stays out of the way when there is nothing to lose', () => {
    renderHook(() => useUnloadGuard(false))
    expect(leavePage()).toBe(false)
  })

  it('stops warning once the work is gone', () => {
    const { rerender } = renderHook(({ on }) => useUnloadGuard(on), {
      initialProps: { on: true },
    })
    expect(leavePage()).toBe(true)
    rerender({ on: false })
    expect(leavePage()).toBe(false)
  })

  it('removes the handler on unmount', () => {
    const { unmount } = renderHook(() => useUnloadGuard(true))
    unmount()
    expect(leavePage()).toBe(false)
  })

  it('never arms in Electron, where it would make the app unquittable', () => {
    // Electron cancels the close on returnValue WITHOUT showing a dialog, so a
    // guard here traps the user in the desktop app with no way out.
    setUserAgent('Mozilla/5.0 Electron/42.3.0 Chrome/120 Safari/537.36')
    renderHook(() => useUnloadGuard(true))
    expect(leavePage()).toBe(false)
  })
})
