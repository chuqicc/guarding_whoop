import { useStore } from '../store/useStore'
import { toggleBtnStyle } from '../utils/buttonStyle'

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

  // ── Playback mode handlers ───────────────────────────────────────────────
  const handleAnim = () => setPlaying(!isPlaying)
  const handleVideo = () => setVideoPlaying(!isVideoPlaying)
  const handleBoth = () => {
    const next = !(isPlaying && isVideoPlaying)
    setPlaying(next)
    setVideoPlaying(next)
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
      {/* Play mode buttons */}
      <button
        onClick={handleAnim}
        title="Play tracking animation"
        style={toggleBtnStyle(isPlaying, 'mode')}
      >
        {isPlaying ? '⏸' : '▶'} Anim
      </button>
      <button
        onClick={handleVideo}
        title="Play video"
        style={toggleBtnStyle(isVideoPlaying, 'mode')}
      >
        {isVideoPlaying ? '⏸' : '▶'} Video
      </button>
      <button
        onClick={handleBoth}
        title="Play animation and video together"
        style={toggleBtnStyle(isPlaying && isVideoPlaying, 'mode')}
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
            ...toggleBtnStyle(playbackSpeed === s, 'warn'),
            padding: '2px 8px', fontSize: 12,
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
          style={{ position: 'absolute', width: '100%', margin: 0, accentColor: 'var(--accent)' }}
        />
      </div>

      {/* Clock display */}
      <span style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 90, textAlign: 'right' }}>
        Q{quarter} {formatClock(quarterClock)}
      </span>
      {shotClock !== null && (
        <span style={{ fontSize: 13, color: shotClock <= 5 ? 'var(--accent-danger)' : 'var(--text-3)', minWidth: 60 }}>
          Shot: {shotClock.toFixed(1)}
        </span>
      )}
    </div>
  )
}
