import { useStore } from '../store/useStore'

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlaybackControls() {
  const isPlaying = useStore(s => s.isPlaying)
  const setPlaying = useStore(s => s.setPlaying)
  const currentFrame = useStore(s => s.currentFrame)
  const frames = useStore(s => s.frames)
  const setCurrentFrame = useStore(s => s.setCurrentFrame)
  const playbackSpeed = useStore(s => s.playbackSpeed)
  const setSpeed = useStore(s => s.setSpeed)
  const possession = useStore(s => s.possession)

  const frame = frames[currentFrame]
  const quarterClock = frame?.quarterClock ?? 0
  const shotClock = frame?.shotClock ?? null
  const quarter = possession?.quarter ?? 1

  const speeds = [0.5, 1, 2, 4]

  return (
    <div
      style={{
        height: 48, background: 'var(--bg-panel)', display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 10, flexShrink: 0,
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Play/Pause */}
      <button
        onClick={() => setPlaying(!isPlaying)}
        style={{
          background: '#2a3a5a', color: 'white', border: 'none',
          width: 32, height: 32, borderRadius: 4, cursor: 'pointer',
          fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

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
          }}
        >
          {s}×
        </button>
      ))}

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={Math.max(0, frames.length - 1)}
        value={currentFrame}
        onChange={e => {
          setPlaying(false)
          setCurrentFrame(Number(e.target.value))
        }}
        style={{ flex: 1, accentColor: '#4a90d9' }}
      />

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
