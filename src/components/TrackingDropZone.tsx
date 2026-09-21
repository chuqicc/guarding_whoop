import { useState } from 'react'
import type { QuarterMeta } from '../store/useStore'

/**
 * Drop zone for the raw quarter tracking JSON, or the game video.
 *
 * The compare flow parses the tracking itself rather than going through the
 * store's `loadQuarter`, which clears `cellAnnotations` and resets the undo
 * history — that would wipe an annotator's open work.
 */
export default function TrackingDropZone({ label, hint, accept, loaded, error, onFile }: {
  label: string
  hint: string
  accept: string
  loaded: string | null
  error: string | null
  onFile: (f: File) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <label
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false)
        const f = e.dataTransfer.files[0]; if (f) onFile(f)
      }}
      style={{
        flex: 1, minHeight: 74, cursor: 'pointer', borderRadius: 6, padding: 10,
        background: 'var(--bg-panel)',
        border: `1px dashed ${over ? 'var(--accent, #4a90d9)' : error ? 'var(--accent-danger)' : 'var(--border)'}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>{label}</div>
      {loaded ? (
        <div style={{ fontSize: 12 }}>
          <strong style={{ fontSize: 14 }}>{loaded}</strong>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: error ? 'var(--accent-danger)' : 'var(--text-3)' }}>
          {error ?? hint}
        </div>
      )}
      <input
        type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}

export interface LoadedTracking {
  filename: string
  frames: import('../store/useStore').TrackingFrame[]
  quarterMeta: QuarterMeta
  playerDict: Record<number, import('../store/useStore').Player>
}
