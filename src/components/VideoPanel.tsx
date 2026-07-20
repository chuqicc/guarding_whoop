import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { toggleBtnStyle } from '../utils/buttonStyle'

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoUrl        = useStore(s => s.videoUrl)
  const setVideoUrl     = useStore(s => s.setVideoUrl)
  const isVideoPlaying  = useStore(s => s.isVideoPlaying)
  const setVideoPlaying = useStore(s => s.setVideoPlaying)
  const playbackSpeed   = useStore(s => s.playbackSpeed)

  const [dragOver,    setDragOver]    = useState(false)
  const [vidTime,     setVidTime]     = useState(0)
  const [vidDuration, setVidDuration] = useState(0)

  // ── Video play/pause (reacts to isVideoPlaying) ───────────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid?.src) return
    if (isVideoPlaying) {
      vid.playbackRate = playbackSpeed
      vid.play().catch(() => {})
    } else {
      vid.pause()
    }
  }, [isVideoPlaying]) // eslint-disable-line

  // ── Speed change ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current?.src) videoRef.current.playbackRate = playbackSpeed
  }, [playbackSpeed])

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

  const toggleVideo = () => setVideoPlaying(!isVideoPlaying)

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
                title={isVideoPlaying ? 'Pause video' : 'Play video'}
                style={{
                  ...toggleBtnStyle(isVideoPlaying, 'mode'),
                  width: 26, height: 26, borderRadius: 3, padding: 0,
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
                style={{ flex: 1, accentColor: 'var(--accent-danger)', height: 3 }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 72, textAlign: 'right', flexShrink: 0 }}>
                {fmtTime(vidTime)} / {fmtTime(vidDuration)}
              </span>
            </div>

            {/* Row 2: video seek buttons + replace */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => seekBy(-5)} title="−5 seconds" style={toggleBtnStyle(false)}>−5s</button>
              <button onClick={() => seekBy(-1)} title="−1 second"  style={toggleBtnStyle(false)}>−1s</button>
              <button onClick={() => seekBy(+1)} title="+1 second"  style={toggleBtnStyle(false)}>+1s</button>
              <button onClick={() => seekBy(+5)} title="+5 seconds" style={toggleBtnStyle(false)}>+5s</button>

              <label title="Replace video file" style={{ ...toggleBtnStyle(false), cursor: 'pointer', marginLeft: 'auto', flexShrink: 0 }}>
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
            border: dragOver ? '2px solid var(--accent)' : '2px dashed var(--border)',
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
