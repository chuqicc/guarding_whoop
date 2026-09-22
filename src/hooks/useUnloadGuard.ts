import { useEffect } from 'react'

/**
 * Warn before leaving the page while unsaved in-memory work would be lost.
 *
 * Every loaded file — the tracking JSON, both annotators' exports, the video
 * blob — lives in memory only, so any navigation away discards the session and
 * it all has to be imported again.
 *
 * The primary fix for the reported case is CSS: `overscroll-behavior-x` stops a
 * trackpad swipe from becoming browser back/forward. This is the second layer,
 * for the ways out that CSS cannot intercept (the back button, ⌘+[, closing
 * the tab).
 *
 * Deliberately browser-only. In Electron a `beforeunload` handler that sets
 * `returnValue` cancels the window close *without* showing a dialog, which
 * would leave the desktop app impossible to quit.
 */
const isElectron = () =>
  typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)

export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active || isElectron()) return

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Legacy browsers need returnValue set; the string itself is ignored.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])
}
