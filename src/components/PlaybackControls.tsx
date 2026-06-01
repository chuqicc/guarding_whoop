import { useStore } from '../store/useStore'

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlaybackControls() {
  const isPlaying      = useStore(s => s.isPlaying)
  const isVideoPlaying = useStore(s => s.isVideoPlaying)
  const setPlaying     = useStore(s => s.setPlaying)
  const setVideoPlaying = useStore(s => s.setVideoPlaying)
  const currentFrame   = useStore(s => s.currentFrame)
  const frames = useStore(s => s.frames)
  const setCurrentFrame = useStore(s => s.setCurrentFrame)
  const playbackSpeed = useStore(s => s.playbackSpeed)
  const setSpeed = useStore(s => s.setSpeed)
  const possession  = useStore(s => s.possession)
  const quarterMeta = useStore(s => s.quarterMeta)
  const gapFrames   = useStore(s => s.gapFrames)
  const syncPoints  = useStore(s => s.syncPoints)

  const frame = frames[currentFrame]
  const quarterClock = frame?.quarterClock ?? 0
  const shotClock = frame?.shotClock ?? null
  const quarter = possession?.quarter ?? quarterMeta?.quarter ?? 1

  const speeds = [0.5, 1, 2, 4]
  const maxFrame = Math.max(0, frames.length - 1)

  const stepFrames = (delta: number) => {
    setPlaying(false)
    setCurrentFrame(Math.min(maxFrame, Math.max(0, currentFrame + delta)))
  }

  // ── Three playback mode handlers ─────────────────────────────────────────
  const handleAnim = () => {
    if (isPlaying && !isVideoPlaying) { setPlaying(false) }          // already anim-only → pause
    else { setPlaying(true); setVideoPlaying(false) }                 // switch to anim-only
  }
  const handleVideo = () => {
    if (isVideoPlaying && !isPlaying) { setVideoPlaying(false) }     // already video-only → pause
    else { setVideoPlaying(true); setPlaying(false) }                 // switch to video-only
  }
  const handleBoth = () => {
    if (isPlaying && isVideoPlaying) { setPlaying(false); setVideoPlaying(false) }  // pause both
    else { setPlaying(true); setVideoPlaying(true) }                  // start both synced
  }

  return (
    <div
      style={{
        height: 48, background: 'var(--bg-panel)', display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 8, flexShrink: 0,
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Three play mode buttons */}
      <button
        onClick={handleAnim}
        title="Play tracking animation only"
        style={modeBtn(isPlaying && !isVideoPlaying)}
      >
        {isPlaying && !isVideoPlaying ? '⏸' : '▶'} Anim
      </button>
      <button
        onClick={handleVideo}
        title="Play video only (no animation)"
        style={modeBtn(isVideoPlaying && !isPlaying)}
      >
        {isVideoPlaying && !isPlaying ? '⏸' : '▶'} Video
      </button>
      <button
        onClick={handleBoth}
        title="Play both synced"
        style={modeBtn(isPlaying && isVideoPlaying)}
      >
        {isPlaying && isVideoPlaying ? '⏸' : '▶'} Both
      </button>

      {/* Frame step buttons */}
      {([-5, -1, 1, 5] as const).map(d => (
        <button
          key={d}
          onClick={() => stepFrames(d)}
          title={`${d > 0 ? '+' : ''}${d} frame${Math.abs(d) > 1 ? 's' : ''}`}
          style={{
            background: 'var(--bg-surface)', color: 'var(--text-3)',
            border: '1px solid var(--border)',
            padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
            flexShrink: 0,
          }}
        >
          {d > 0 ? '+' : ''}{d}f
        </button>
      ))}

      {/* Speed buttons */}
      {speeds.map(s => (
        <button
          key={s}
          onClick={() => setSpeed(s)}
          style={{
            background: playbackSpeed === s ? '#c8860a' : 'var(--bg-surface)',
            color: playbackSpeed === s ? 'white' : 'var(--text-2)',
            border: '1px solid var(--border)',
            padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
            flexShrink: 0,
          }}
        >
          {s}×
        </button>
      ))}

      {/* Scrubber with gap/sync overlays */}
      <div style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <input
          type="range"
          min={0}
          max={maxFrame}
          value={currentFrame}
          onChange={e => {
            setPlaying(false)
            setCurrentFrame(Number(e.target.value))
          }}
          style={{ position: 'absolute', width: '100%', margin: 0, accentColor: '#4a90d9' }}
        />
        {/* Visual overlay — pointer-events: none so clicks go to the range input */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {gapFrames.map(g => (
            <div
              key={g.frameIndex}
              title={`Gap: ${g.clockJump.toFixed(1)}s dead ball`}
              style={{
                position: 'absolute',
                left: `${maxFrame > 0 ? g.frameIndex / maxFrame * 100 : 0}%`,
                top: 0, bottom: 0, width: 2,
                background: '#e05c5c', opacity: 0.75,
              }}
            />
          ))}
          {syncPoints.map(sp => (
            <div
              key={sp.id}
              title={`Sync: f${sp.frame} → ${sp.videoTime.toFixed(2)}s`}
              style={{
                position: 'absolute',
                left: `${maxFrame > 0 ? sp.frame / maxFrame * 100 : 0}%`,
                top: 3, bottom: 3, width: 2,
                background: '#5cb85c', opacity: 0.9,
              }}
            />
          ))}
        </div>
      </div>

      {/* Clock display */}
      <span style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 90, textAlign: 'right' }}>
        Q{quarter} {formatClock(quarterClock)}
      </span>
      {shotClock !== null && (
        <span style={{ fontSize: 13, color: shotClock <= 5 ? '#e05c5c' : 'var(--text-3)', minWidth: 60 }}>
          Shot: {shotClock.toFixed(1)}
        </span>
      )}
    </div>
  )
}

function modeBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? '#2a5a2a' : '#2a3a5a',
    color: 'white', border: 'none',
    height: 28, padding: '0 10px', borderRadius: 4, cursor: 'pointer',
    fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' as const,
  }
}
