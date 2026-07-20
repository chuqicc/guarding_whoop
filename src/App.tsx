import { useEffect, useRef, useState } from 'react'
import UploadPage from './pages/UploadPage'
import PossessionSetupPage from './pages/PossessionSetupPage'
import QuarterSetupPage from './pages/QuarterSetupPage'
import VideoSplitPage from './pages/VideoSplitPage'
import TopBar from './components/TopBar'
import VideoPanel from './components/VideoPanel'
import CourtCanvas from './components/CourtCanvas'
import RosterPanel from './components/RosterPanel'
import PlaybackControls from './components/PlaybackControls'
import AnnotationArea from './components/AnnotationArea'
import { useStore } from './store/useStore'

// ── Panel size constants ─────────────────────────────────────────────────────
const VIDEO_DEFAULT_W = 480
const VIDEO_MIN_W = 180
const VIDEO_MAX_W = 900

const TOP_DEFAULT_H = 340
const TOP_MIN_H = 150
const TOP_MAX_H = 700

const ROSTER_DEFAULT_W = 280
const ROSTER_MIN_W = 140
const ROSTER_MAX_W = 500

export default function App() {
  const [page, setPage] = useState<'home' | 'possession-setup' | 'possession' | 'quarter-setup' | 'quarter' | 'split'>('home')
  const [videoPx,  setVideoPx]  = useState(VIDEO_DEFAULT_W)
  const [topPx,    setTopPx]    = useState(TOP_DEFAULT_H)
  const [rosterPx, setRosterPx] = useState(ROSTER_DEFAULT_W)

  const theme       = useStore(s => s.theme)
  const isPlaying   = useStore(s => s.isPlaying)
  const currentFrame = useStore(s => s.currentFrame)
  const frames      = useStore(s => s.frames)
  const setCurrentFrame = useStore(s => s.setCurrentFrame)
  const setPlaying  = useStore(s => s.setPlaying)
  const playbackSpeed = useStore(s => s.playbackSpeed)
  const pendingRestore    = useStore(s => s.pendingRestore)
  const setCellAnnotations = useStore(s => s.setCellAnnotations)
  const dismissRestore    = useStore(s => s.dismissRestore)

  // Refs for RAF loop (avoid stale closures)
  const frameRef     = useRef(currentFrame)
  const framesLenRef = useRef(frames.length)
  const speedRef     = useRef(playbackSpeed)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => { frameRef.current = currentFrame },       [currentFrame])
  useEffect(() => { framesLenRef.current = frames.length },  [frames.length])
  useEffect(() => { speedRef.current = playbackSpeed },      [playbackSpeed])

  // ── Tracking animation loop ───────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || frames.length === 0) return
    let lastTime: number | null = null
    let accumulated = 0
    let rafId: number

    const tick = (now: number) => {
      if (lastTime !== null) {
        accumulated += (now - lastTime) * speedRef.current
        const adv = Math.floor(accumulated / 40)
        if (adv > 0) {
          accumulated -= adv * 40
          const next = frameRef.current + adv
          if (next >= framesLenRef.current - 1) {
            setCurrentFrame(framesLenRef.current - 1)
            setPlaying(false)
            return
          }
          setCurrentFrame(next)
        }
      }
      lastTime = now
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, frames.length]) // eslint-disable-line

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        const { isPlaying, setPlaying } = useStore.getState()
        setPlaying(!isPlaying)
      }
      if (e.code === 'ArrowRight') {
        useStore.getState().setCurrentFrame(
          Math.min(useStore.getState().currentFrame + 25, framesLenRef.current - 1)
        )
      }
      if (e.code === 'ArrowLeft') {
        useStore.getState().setCurrentFrame(
          Math.max(useStore.getState().currentFrame - 25, 0)
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Drag-to-resize vertical divider (video ↔ court) ─────────────────────
  const dividerDrag = useRef<{ startX: number; startW: number } | null>(null)

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dividerDrag.current = { startX: e.clientX, startW: videoPx }
    const onMove = (ev: MouseEvent) => {
      if (!dividerDrag.current) return
      const delta = ev.clientX - dividerDrag.current.startX
      setVideoPx(Math.max(VIDEO_MIN_W, Math.min(VIDEO_MAX_W, dividerDrag.current.startW + delta)))
    }
    const onUp = () => {
      dividerDrag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Drag-to-resize roster panel (court ↔ roster) ────────────────────────
  const rosterDrag = useRef<{ startX: number; startW: number } | null>(null)

  const onRosterDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    rosterDrag.current = { startX: e.clientX, startW: rosterPx }
    const onMove = (ev: MouseEvent) => {
      if (!rosterDrag.current) return
      // dragging left increases roster width
      const delta = rosterDrag.current.startX - ev.clientX
      setRosterPx(Math.max(ROSTER_MIN_W, Math.min(ROSTER_MAX_W, rosterDrag.current.startW + delta)))
    }
    const onUp = () => {
      rosterDrag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Drag-to-resize horizontal divider (top ↔ annotation area) ────────────
  const horizDrag = useRef<{ startY: number; startH: number } | null>(null)

  const onHorizDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    horizDrag.current = { startY: e.clientY, startH: topPx }
    const onMove = (ev: MouseEvent) => {
      if (!horizDrag.current) return
      const delta = ev.clientY - horizDrag.current.startY
      setTopPx(Math.max(TOP_MIN_H, Math.min(TOP_MAX_H, horizDrag.current.startH + delta)))
    }
    const onUp = () => {
      horizDrag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Page routing ─────────────────────────────────────────────────────────
  if (page === 'home') {
    return <UploadPage
      onPossession={() => setPage('possession-setup')}
      onQuarter={() => setPage('quarter-setup')}
      onSplit={() => setPage('split')}
    />
  }
  if (page === 'possession-setup') {
    return <PossessionSetupPage onStart={() => setPage('possession')} onBack={() => setPage('home')} />
  }
  if (page === 'quarter-setup') {
    return <QuarterSetupPage onStart={() => setPage('quarter')} onBack={() => setPage('home')} />
  }
  if (page === 'split') {
    return <VideoSplitPage onBack={() => setPage('home')} />
  }

  // ── Annotate page ─────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      overflow: 'hidden', background: 'var(--bg-page)',
    }}>
      {/* Restore banner */}
      {pendingRestore && (
        <div style={{
          background: '#1e3a6e', borderBottom: '1px solid #3a5a9e',  /* accent — intentionally fixed */
          padding: '6px 16px', display: 'flex', alignItems: 'center',
          gap: 12, flexShrink: 0,
        }}>
          <span style={{ flex: 1, fontSize: 13 }}>
            Previous annotations found. Restore them?
          </span>
          <button onClick={() => { setCellAnnotations(pendingRestore); dismissRestore() }} style={bannerBtn('#4a90d9')}>
            Yes, restore
          </button>
          <button onClick={dismissRestore} style={bannerBtn('#333')}>
            No, start fresh
          </button>
        </div>
      )}

      <TopBar onNewSession={() => setPage('home')} />

      {/* Tracking timeline — full width for finer control */}
      <PlaybackControls />

      {/* Top row: [Video | divider | Court | Roster] */}
      <div style={{ display: 'flex', flexShrink: 0, height: topPx, minHeight: 0 }}>
        {/* Video panel — resizable width */}
        <div style={{ width: videoPx, flexShrink: 0, overflow: 'hidden' }}>
          <VideoPanel />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onDividerMouseDown}
          title="Drag to resize"
          style={{
            width: 6, flexShrink: 0, background: 'var(--bg-surface)',
            borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
            cursor: 'col-resize', display: 'flex', alignItems: 'center',
            justifyContent: 'center', userSelect: 'none', zIndex: 10,
          }}
        >
          <span style={{ color: 'var(--divider-fg)', fontSize: 10, writingMode: 'vertical-rl', letterSpacing: 2 }}>⠿</span>
        </div>

        {/* Court — takes remaining space */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CourtCanvas />
          </div>
        </div>

        {/* Drag handle between court and roster */}
        <div
          onMouseDown={onRosterDividerMouseDown}
          title="Drag to resize roster"
          style={{
            width: 6, flexShrink: 0, background: 'var(--bg-surface)',
            borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
            cursor: 'col-resize', display: 'flex', alignItems: 'center',
            justifyContent: 'center', userSelect: 'none', zIndex: 10,
          }}
        >
          <span style={{ color: 'var(--divider-fg)', fontSize: 10, writingMode: 'vertical-rl', letterSpacing: 2 }}>⠿</span>
        </div>

        {/* Roster — resizable */}
        <div style={{ width: rosterPx, flexShrink: 0, overflow: 'hidden' }}>
          <RosterPanel />
        </div>
      </div>

      {/* Horizontal drag handle between top section and annotation area */}
      <div
        onMouseDown={onHorizDividerMouseDown}
        title="Drag to resize"
        style={{
          height: 6, flexShrink: 0,
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          cursor: 'row-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          userSelect: 'none', zIndex: 10,
        }}
      >
        <span style={{ color: 'var(--divider-fg)', fontSize: 10, letterSpacing: 4 }}>⠿</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <AnnotationArea />
      </div>
    </div>
  )
}

function bannerBtn(bg: string): React.CSSProperties {
  return {
    background: bg, color: 'white', border: 'none',
    padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  }
}
