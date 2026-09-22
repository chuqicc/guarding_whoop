import { useEffect, useRef, useState } from 'react'
import { stepBucket } from './utils/frameNav'
import { isEditableTarget } from './utils/isEditableTarget'
import UploadPage from './pages/UploadPage'
import QuarterSetupPage from './pages/QuarterSetupPage'
import TopBar from './components/TopBar'
import VideoPanel from './components/VideoPanel'
import CourtCanvas from './components/CourtCanvas'
import RosterPanel from './components/RosterPanel'
import PlaybackControls from './components/PlaybackControls'
import AnnotationArea from './components/AnnotationArea'
import SpellTimeline from './components/SpellTimeline'
import ComparePage from './pages/ComparePage'
import DeadBallReviewPage from './pages/DeadBallReviewPage'
import type { AnnotationDocument } from './utils/annotationDocument'
import type { LoadedTracking } from './components/TrackingDropZone'
import { useStore } from './store/useStore'
import { useResizable } from './hooks/useResizable'
import { useUnloadGuard } from './hooks/useUnloadGuard'
import ResizeHandle from './components/ResizeHandle'

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
  const [page, setPage] = useState<'home' | 'quarter-setup' | 'quarter' | 'compare' | 'dead-review'>('home')

  // The two annotators' files live here so the compare and review pages share
  // them — navigating between the two must not mean re-dropping files.
  // The keyboard effect below has empty deps, so it would close over a stale
  // page value; a ref keeps the guard reading the live route.
  const pageRef = useRef(page)
  useEffect(() => { pageRef.current = page }, [page])

  const [docA, setDocA] = useState<AnnotationDocument | null>(null)
  const [docB, setDocB] = useState<AnnotationDocument | null>(null)

  // The compare flow owns its own tracking and video so it never disturbs the
  // annotate session: loadQuarter would clear cellAnnotations, and setVideoUrl
  // revokes the annotator's blob URL.
  const [tracking, setTracking] = useState<LoadedTracking | null>(null)
  const [compareVideo, setCompareVideo] = useState<string | null>(null)
  const setVideoFile = (f: File | null) => {
    setCompareVideo(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return f ? URL.createObjectURL(f) : null
    })
  }

  // Cells are how the work is entered; spells are the unit the analysis reads.
  const [bottomView, setBottomView] = useState<'grid' | 'spells'>('grid')

  // Transient confirmation of an undo/redo, so the annotator can see that a
  // destructive action was reversible and what exactly came back.
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])
  const videoW  = useResizable({ axis: 'x', initial: VIDEO_DEFAULT_W,  min: VIDEO_MIN_W,  max: VIDEO_MAX_W })
  // The roster sits on the right, so dragging left must grow it.
  const rosterW = useResizable({ axis: 'x', initial: ROSTER_DEFAULT_W, min: ROSTER_MIN_W, max: ROSTER_MAX_W, invert: true })
  const topH    = useResizable({ axis: 'y', initial: TOP_DEFAULT_H,    min: TOP_MIN_H,    max: TOP_MAX_H })

  const theme       = useStore(s => s.theme)
  const isPlaying   = useStore(s => s.isPlaying)
  const currentFrame = useStore(s => s.currentFrame)
  const frames      = useStore(s => s.frames)

  // Everything loaded lives in memory, so leaving the page throws the session
  // away. Arm the warning only when there is actually something to lose.
  useUnloadGuard(
    frames.length > 0 || docA !== null || docB !== null
    || tracking !== null || compareVideo !== null,
  )
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
      // Covers textarea and contenteditable too — the old HTMLInputElement-only
      // check meant Space in the notes textarea toggled playback and was eaten.
      if (isEditableTarget(e.target)) return

      // These hooks run before the routing returns, so they are live on every
      // page. The read-only pages must not reach undo/redo — it mutates the
      // annotator's saved work — and stepping buckets there means nothing.
      if (pageRef.current === 'compare' || pageRef.current === 'dead-review') return

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const label = e.shiftKey ? useStore.getState().redo() : useStore.getState().undo()
        setToast(label ? `${e.shiftKey ? 'Redo' : 'Undo'}: ${label}` : 'Nothing to undo')
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        const { isPlaying, setPlaying } = useStore.getState()
        setPlaying(!isPlaying)
      }
      // One press = one annotation column. Stepping a fixed frame count
      // drifts off the grid, because a 0.5s bucket is 12–13 frames at 25fps
      // and real tracking data is unevenly spaced.
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault()
        const { frames, currentFrame, setCurrentFrame, setPlaying } = useStore.getState()
        // Otherwise the animation loop overwrites the step on the next tick,
        // the same reason the ±1f buttons pause.
        setPlaying(false)
        setCurrentFrame(stepBucket(frames, currentFrame, e.code === 'ArrowRight' ? 1 : -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Drag-to-resize vertical divider (video ↔ court) ─────────────────────

  // ── Drag-to-resize roster panel (court ↔ roster) ────────────────────────

  // ── Drag-to-resize horizontal divider (top ↔ annotation area) ────────────

  // ── Page routing ─────────────────────────────────────────────────────────
  if (page === 'home') {
    return <UploadPage
      onQuarter={() => setPage('quarter-setup')}
      onCompare={() => setPage('compare')}
    />
  }
  if (page === 'compare') {
    return <ComparePage
      onBack={() => setPage('home')}
      docA={docA} docB={docB} setDocA={setDocA} setDocB={setDocB}
      tracking={tracking} setTracking={setTracking}
      videoUrl={compareVideo} setVideoFile={setVideoFile}
      onReviewDeadBalls={() => setPage('dead-review')}
    />
  }
  if (page === 'dead-review') {
    return <DeadBallReviewPage
      docA={docA} docB={docB}
      tracking={tracking} videoUrl={compareVideo} setVideoFile={setVideoFile}
      onBack={() => setPage('compare')}
    />
  }
  if (page === 'quarter-setup') {
    return <QuarterSetupPage onStart={() => setPage('quarter')} onBack={() => setPage('home')} />
  }

  // ── Annotate page ─────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      overflow: 'hidden', background: 'var(--bg-page)',
    }}>
      {/* Undo/redo confirmation */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--bg-panel)', color: 'var(--text-1)',
            border: '1px solid var(--border)', borderRadius: 6,
            padding: '8px 16px', fontSize: 13, zIndex: 1000,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', pointerEvents: 'none',
          }}
        >
          {toast}
        </div>
      )}

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
      <div style={{ display: 'flex', flexShrink: 0, height: topH.size, minHeight: 0 }}>
        {/* Video panel — resizable width */}
        <div style={{ width: videoW.size, flexShrink: 0, overflow: 'hidden' }}>
          <VideoPanel />
        </div>

        <ResizeHandle resizable={videoW} label="Resize the video panel" />

        {/* Court — takes remaining space */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <CourtCanvas />
          </div>
        </div>

        <ResizeHandle resizable={rosterW} label="Resize the roster panel" />

        {/* Roster — resizable */}
        <div style={{ width: rosterW.size, flexShrink: 0, overflow: 'hidden' }}>
          <RosterPanel />
        </div>
      </div>

      <ResizeHandle resizable={topH} label="Resize the video and court row" />

      {/* Bottom pane: per-bucket grid, or the spells derived from it */}
      <div style={{
        display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0,
        padding: '4px 10px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
      }}>
        {(['grid', 'spells'] as const).map(v => (
          <button
            key={v}
            onClick={() => setBottomView(v)}
            aria-pressed={bottomView === v}
            title={v === 'grid'
              ? 'Per-bucket assignment grid'
              : 'Marking spells — consecutive buckets on the same attacker, merged'}
            style={{
              background: bottomView === v ? 'var(--bg-col-active)' : 'transparent',
              color: bottomView === v ? 'var(--text-1)' : 'var(--text-3)',
              border: `1px solid ${bottomView === v ? 'var(--border)' : 'transparent'}`,
              borderRadius: 4, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
            }}
          >
            {v === 'grid' ? '▦ Grid' : '▬ Spells'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {bottomView === 'grid' ? <AnnotationArea /> : <SpellTimeline />}
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
