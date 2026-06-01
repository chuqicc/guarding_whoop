import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

function fmtTime(s: number) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoUrl    = useStore(s => s.videoUrl)
  const videoOffset = useStore(s => s.videoOffset)
  const setVideoUrl = useStore(s => s.setVideoUrl)
  const setVideoOffset = useStore(s => s.setVideoOffset)
  const isPlaying   = useStore(s => s.isPlaying)
  const setPlaying  = useStore(s => s.setPlaying)
  const currentFrame = useStore(s => s.currentFrame)
  const playbackSpeed = useStore(s => s.playbackSpeed)

  const [dragOver, setDragOver] = useState(false)
  const [offsetInput, setOffsetInput] = useState('0')
  const [vidTime, setVidTime] = useState(0)
  const [vidDuration, setVidDuration] = useState(0)

  // ── Stable refs (avoid stale closures) ─────────────────────────────────
  const isPlayingRef    = useRef(isPlaying)
  const currentFrameRef = useRef(currentFrame)
  const videoOffsetRef  = useRef(videoOffset)
  const speedRef        = useRef(playbackSpeed)
  useEffect(() => { isPlayingRef.current = isPlaying },      [isPlaying])
  useEffect(() => { currentFrameRef.current = currentFrame }, [currentFrame])
  useEffect(() => { videoOffsetRef.current = videoOffset },   [videoOffset])
  useEffect(() => { speedRef.current = playbackSpeed },       [playbackSpeed])

  const expectedTime = (frame: number) =>
    Math.max(0, frame * 0.04 + videoOffsetRef.current)

  // ── Sync: play / pause ─────────────────────────────────────────────────
  // On play: always seek video to match current tracking position (via offset),
  // then start. On pause: just pause — video stays where it is so scrubbing
  // either timeline is fully independent.
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src) return
    if (isPlaying) {
      vid.playbackRate = speedRef.current
      vid.currentTime = expectedTime(currentFrameRef.current)
      vid.play().catch(() => {})
    } else {
      vid.pause()
      // Do NOT seek — let both timelines be independently scrubbed while paused
    }
  }, [isPlaying]) // eslint-disable-line

  // ── Sync: speed change ─────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current?.src) videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed])

  // ── Sync: offset change ────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src) return
    setOffsetInput(videoOffset.toFixed(2))
    vid.currentTime = expectedTime(currentFrameRef.current)
  }, [videoOffset]) // eslint-disable-line

  // ── Sync: drift correction every 1s during playback ───────────────────
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      const vid = videoRef.current
      if (!vid?.src || vid.paused) return
      const expected = expectedTime(currentFrameRef.current)
      if (Math.abs(vid.currentTime - expected) > 0.5) {
        vid.currentTime = expected
      }
    }, 1000)
    return () => clearInterval(id)
  }, [isPlaying]) // eslint-disable-line

  // ── Listen to video time / duration events ────────────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime     = () => setVidTime(vid.currentTime)
    const onDuration = () => setVidDuration(vid.duration || 0)
    const onEnded    = () => setPlaying(false)
    vid.addEventListener('timeupdate',     onTime)
    vid.addEventListener('durationchange', onDuration)
    vid.addEventListener('ended',          onEnded)
    return () => {
      vid.removeEventListener('timeupdate',     onTime)
      vid.removeEventListener('durationchange', onDuration)
      vid.removeEventListener('ended',          onEnded)
    }
  }, [videoUrl]) // eslint-disable-line

  // ── File loading ───────────────────────────────────────────────────────
  const loadFile = (file: File) => {
    if (!file.type.startsWith('video/')) return
    setVideoUrl(URL.createObjectURL(file))
    setOffsetInput('0')
    setVidTime(0)
    setVidDuration(0)
  }

  const applyOffset = () => {
    const v = parseFloat(offsetInput)
    if (!isNaN(v)) setVideoOffset(v)
  }

  // ── Video scrubber: independent of tracking ────────────────────────────
  const handleVideoScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    setVidTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
    // Does NOT update currentFrame — video timeline is independent
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg-video)', overflow: 'hidden',
      borderRight: '1px solid var(--border)', height: '100%',
    }}>
      {videoUrl ? (
        <>
          {/* ── Video ── */}
          <video
            ref={videoRef}
            src={videoUrl}
            controls={false}
            muted={false}
            preload="auto"
            style={{ flex: 1, width: '100%', objectFit: 'contain', background: '#000', display: 'block', minHeight: 0 }}
          />

          {/* ── Video timeline ── */}
          <div style={{
            flexShrink: 0, background: 'var(--bg-surface)',
            borderTop: '1px solid var(--border)', padding: '4px 8px',
            display: 'flex', flexDirection: 'column', gap: 3,
          }}>
            {/* Scrubber row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Play/pause shares global state — both video and tracking move together */}
              <button
                onClick={() => setPlaying(!isPlaying)}
                style={{
                  background: '#2a3a5a', color: 'white', border: 'none',
                  width: 26, height: 26, borderRadius: 3, cursor: 'pointer',
                  fontSize: 12, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={vidDuration || 1}
                step={0.04}
                value={vidTime}
                onChange={handleVideoScrub}
                style={{ flex: 1, accentColor: '#e05c5c', height: 3 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 72, textAlign: 'right', flexShrink: 0 }}>
                {fmtTime(vidTime)} / {fmtTime(vidDuration)}
              </span>
            </div>

            {/* Offset row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, color: 'var(--text-4)', flexShrink: 0 }}>Offset (s):</span>
              <input
                type="number"
                step="0.04"
                value={offsetInput}
                onChange={e => setOffsetInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyOffset()}
                style={{
                  width: 62, padding: '1px 4px', fontSize: 11,
                  background: 'var(--bg-input)', color: 'var(--text-1)',
                  border: '1px solid var(--border)', borderRadius: 3,
                }}
              />
              <button onClick={applyOffset} style={btnStyle('#1e3a5a')}>Apply</button>
              <button
                onClick={() => { const v = videoOffset - 0.04; setVideoOffset(v); setOffsetInput(v.toFixed(2)) }}
                title="−1 frame"
                style={btnStyle()}
              >◀1f</button>
              <button
                onClick={() => { const v = videoOffset + 0.04; setVideoOffset(v); setOffsetInput(v.toFixed(2)) }}
                title="+1 frame"
                style={btnStyle()}
              >1f▶</button>
              <label style={{ ...btnStyle(), marginLeft: 'auto', cursor: 'pointer' }}>
                ⬆ Replace
                <input type="file" accept="video/*" style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0]) }} />
              </label>
            </div>
          </div>
        </>
      ) : (
        /* Drop zone */
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) loadFile(f)
          }}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: dragOver ? 'var(--bg-surface)' : 'var(--bg-video)',
            border: dragOver ? '2px solid #4a90d9' : `2px dashed var(--border)`,
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
    whiteSpace: 'nowrap' as const,
  }
}
