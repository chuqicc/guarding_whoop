import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { getVideoTimeForFrame } from '../utils/videoSync'

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtSec(s: number) {
  if (!isFinite(s)) return '?.??s'
  const sign = s < 0 ? '−' : ''
  return `${sign}${Math.abs(s).toFixed(2)}s`
}

export default function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoUrl        = useStore(s => s.videoUrl)
  const setVideoUrl     = useStore(s => s.setVideoUrl)
  const syncPoints      = useStore(s => s.syncPoints)
  const gapFrames       = useStore(s => s.gapFrames)
  const addSyncPoint    = useStore(s => s.addSyncPoint)
  const removeSyncPoint = useStore(s => s.removeSyncPoint)
  const clearSyncPoints = useStore(s => s.clearSyncPoints)
  const isPlaying       = useStore(s => s.isPlaying)          // animation channel
  const isVideoPlaying  = useStore(s => s.isVideoPlaying)     // video channel
  const setVideoPlaying = useStore(s => s.setVideoPlaying)
  const setPlaying      = useStore(s => s.setPlaying)
  const currentFrame    = useStore(s => s.currentFrame)
  const frames          = useStore(s => s.frames)
  const playbackSpeed   = useStore(s => s.playbackSpeed)

  const [dragOver,    setDragOver]    = useState(false)
  const [vidTime,     setVidTime]     = useState(0)
  const [vidDuration, setVidDuration] = useState(0)

  // Stable refs
  const isPlayingRef       = useRef(isPlaying)
  const isVideoPlayingRef  = useRef(isVideoPlaying)
  const currentFrameRef    = useRef(currentFrame)
  const syncPointsRef      = useRef(syncPoints)
  const speedRef           = useRef(playbackSpeed)
  useEffect(() => { isPlayingRef.current = isPlaying },           [isPlaying])
  useEffect(() => { isVideoPlayingRef.current = isVideoPlaying }, [isVideoPlaying])
  useEffect(() => { currentFrameRef.current = currentFrame },     [currentFrame])
  useEffect(() => { syncPointsRef.current = syncPoints },         [syncPoints])
  useEffect(() => { speedRef.current = playbackSpeed },           [playbackSpeed])

  const expectedTime = (frame: number): number | null =>
    getVideoTimeForFrame(frame, syncPointsRef.current)

  // ── Video play/pause (reacts to isVideoPlaying) ───────────────────────────
  // When video channel turns on:
  //   • Synced mode (isPlaying also true): seek to tracking-computed time first
  //   • Video-only mode: play from current position
  // When video channel turns off: pause
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src) return
    if (isVideoPlaying) {
      vid.playbackRate = speedRef.current
      if (isPlayingRef.current) {
        // Synced: seek to expected time before playing
        const t = expectedTime(currentFrameRef.current)
        if (t !== null) vid.currentTime = t
      }
      vid.play().catch(() => {})
    } else {
      vid.pause()
    }
  }, [isVideoPlaying]) // eslint-disable-line

  // ── Animation started while video already playing → re-sync video ─────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src || !isPlaying || !isVideoPlayingRef.current) return
    const t = expectedTime(currentFrameRef.current)
    if (t !== null) {
      vid.playbackRate = speedRef.current
      vid.currentTime = t
    }
  }, [isPlaying]) // eslint-disable-line

  // ── Speed change ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current?.src) videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed])

  // ── Sync points changed → re-seek if video is playing ────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src || !isVideoPlayingRef.current) return
    const t = expectedTime(currentFrameRef.current)
    if (t !== null) vid.currentTime = t
  }, [syncPoints]) // eslint-disable-line

  // ── Drift correction (only in synced mode) ────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !isVideoPlaying) return
    const id = setInterval(() => {
      const vid = videoRef.current
      if (!vid?.src || vid.paused) return
      const t = expectedTime(currentFrameRef.current)
      if (t !== null && Math.abs(vid.currentTime - t) > 0.5) vid.currentTime = t
    }, 1000)
    return () => clearInterval(id)
  }, [isPlaying, isVideoPlaying]) // eslint-disable-line

  // ── Video time / duration ─────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime     = () => setVidTime(vid.currentTime)
    const onDuration = () => setVidDuration(vid.duration || 0)
    const onEnded    = () => setVideoPlaying(false)
    vid.addEventListener('timeupdate',     onTime)
    vid.addEventListener('durationchange', onDuration)
    vid.addEventListener('ended',          onEnded)
    return () => {
      vid.removeEventListener('timeupdate',     onTime)
      vid.removeEventListener('durationchange', onDuration)
      vid.removeEventListener('ended',          onEnded)
    }
  }, [videoUrl]) // eslint-disable-line

  // ── Keyboard shortcut: S = add sync ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'KeyS' && videoRef.current) addSyncHere()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line

  // ── File loading ──────────────────────────────────────────────────────────
  const loadFile = (file: File) => {
    if (!file.type.startsWith('video/')) return
    setVideoUrl(URL.createObjectURL(file))
    setVideoPlaying(false)
    setVidTime(0); setVidDuration(0)
  }

  // ── Video scrubber ────────────────────────────────────────────────────────
  const handleVideoScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    setVidTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }

  const seekBy = (delta: number) => {
    const vid = videoRef.current
    if (!vid) return
    const t = Math.max(0, Math.min(vidDuration || Infinity, vid.currentTime + delta))
    vid.currentTime = t; setVidTime(t)
  }

  // ── Sync actions ──────────────────────────────────────────────────────────
  const addSyncHere = () => {
    const vid = videoRef.current
    if (!vid) return
    addSyncPoint(currentFrameRef.current, vid.currentTime)
  }

  const nudgeSync = (dir: 1 | -1) => {
    const frame = currentFrameRef.current
    const sps = syncPointsRef.current
    const governing = [...sps]
      .filter(p => p.frame <= frame)
      .sort((a, b) => b.frame - a.frame)[0] ?? sps[0]
    if (!governing) return
    removeSyncPoint(governing.id)
    addSyncPoint(governing.frame, governing.videoTime + dir * 0.04)
  }

  // ── Drift warning ─────────────────────────────────────────────────────────
  const lastGap = gapFrames.filter(g => g.frameIndex < currentFrame).at(-1)
  const showDrift = !!lastGap && !syncPoints.some(sp => sp.frame > lastGap.frameIndex)

  // Tracking clock label
  const curQClock = frames[currentFrame]?.quarterClock
  const clockLabel = curQClock !== undefined
    ? `f${currentFrame} · ${Math.floor(curQClock / 60)}:${String(Math.floor(curQClock % 60)).padStart(2, '0')}`
    : `f${currentFrame}`

  // Toggle video: also stop animation if it was running in sync mode
  const toggleVideo = () => {
    const nextVideo = !isVideoPlaying
    setVideoPlaying(nextVideo)
    if (!nextVideo && isPlaying) setPlaying(false)  // stop anim if we were synced
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-video)', overflow: 'hidden',
      borderRight: '1px solid var(--border)', height: '100%',
    }}>
      {videoUrl ? (
        <>
          <video
            ref={videoRef}
            src={videoUrl}
            controls={false}
            muted={false}
            preload="auto"
            style={{ flex: 1, width: '100%', objectFit: 'contain', background: '#000', display: 'block', minHeight: 0 }}
          />

          <div style={{
            flexShrink: 0, background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)', padding: '4px 8px',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>

            {/* Row 1: play + video scrubber + time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={toggleVideo}
                title={isVideoPlaying ? 'Pause video' : 'Play video only'}
                style={{
                  background: isVideoPlaying ? '#3a5a2a' : '#2a3a5a',
                  color: 'white', border: 'none',
                  width: 26, height: 26, borderRadius: 3, cursor: 'pointer',
                  fontSize: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isVideoPlaying ? '⏸' : '▶'}
              </button>
              <input
                type="range"
                min={0} max={vidDuration || 1} step={0.04}
                value={vidTime}
                onChange={handleVideoScrub}
                style={{ flex: 1, accentColor: '#e05c5c', height: 3 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 72, textAlign: 'right', flexShrink: 0 }}>
                {fmtTime(vidTime)} / {fmtTime(vidDuration)}
              </span>
            </div>

            {/* Row 2: video seek buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => seekBy(-5)} title="−5 seconds" style={btnStyle()}>−5s</button>
              <button onClick={() => seekBy(-1)} title="−1 second"  style={btnStyle()}>−1s</button>
              <button onClick={() => seekBy(+1)} title="+1 second"  style={btnStyle()}>+1s</button>
              <button onClick={() => seekBy(+5)} title="+5 seconds" style={btnStyle()}>+5s</button>
            </div>

            {/* Row 3: sync controls */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
              background: 'var(--bg-inter)', borderRadius: 4,
              padding: '3px 6px', border: `1px solid ${showDrift ? '#8a5000' : 'var(--border)'}`,
            }}>
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: 'var(--text-4)' }}>
                  Scrub both to the same moment, then set sync:
                </span>
                {showDrift && (
                  <span style={{ fontSize: 9, color: '#e0860a', fontWeight: 600, marginLeft: 'auto' }}>
                    ⚠ drift after f{lastGap!.frameIndex}
                  </span>
                )}
              </div>

              <span style={{ fontSize: 10, color: '#4a90d9', flexShrink: 0 }}>track {clockLabel}</span>
              <span style={{ fontSize: 10, color: 'var(--text-4)' }}>↔</span>
              <span style={{ fontSize: 10, color: '#e05c5c', flexShrink: 0 }}>video {fmtSec(vidTime)}</span>

              <button
                onClick={addSyncHere}
                title="Lock this frame↔video correspondence as a sync point  [S]"
                style={{
                  background: '#1e4a2a', color: '#5cb85c',
                  border: '1px solid #3a7a3a',
                  padding: '2px 7px', borderRadius: 3,
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  flexShrink: 0, whiteSpace: 'nowrap' as const,
                }}
              >
                🎯 Add sync [S]
              </button>

              <button onClick={() => nudgeSync(-1)} title="Shift video 1 frame earlier" style={btnStyle()}>◀1f</button>
              <button onClick={() => nudgeSync(+1)} title="Shift video 1 frame later"   style={btnStyle()}>1f▶</button>

              {syncPoints.length > 0 && (
                <>
                  <span style={{ fontSize: 9, color: 'var(--text-4)', flexShrink: 0 }}>
                    {syncPoints.length} pt{syncPoints.length !== 1 ? 's' : ''}
                  </span>
                  <button onClick={clearSyncPoints} title="Clear all sync points"
                    style={{ ...btnStyle(), color: '#c05050' }}>
                    ✕ all
                  </button>
                </>
              )}

              <label title="Replace video file" style={{ ...btnStyle(), cursor: 'pointer', marginLeft: 'auto', flexShrink: 0 }}>
                ⬆
                <input type="file" accept="video/*" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0]) }} />
              </label>
            </div>
          </div>
        </>
      ) : (
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files[0]; if (f) loadFile(f)
          }}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: dragOver ? 'var(--bg-surface)' : 'var(--bg-video)',
            border: dragOver ? '2px solid #4a90d9' : '2px dashed var(--border)',
            cursor: 'pointer', gap: 8, margin: 4, borderRadius: 6,
            transition: 'all 0.15s',
          }}
        >
          <span style={{ fontSize: 28 }}>🎬</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Drop video here</span>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>or click to browse</span>
          <input type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0]) }} />
        </label>
      )}
    </div>
  )
}

function btnStyle(bg = 'var(--bg-input)'): React.CSSProperties {
  return {
    background: bg, color: 'var(--text-2)', border: '1px solid var(--border)',
    padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 10,
    whiteSpace: 'nowrap' as const, flexShrink: 0,
  }
}
