import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target!.result as string)
    r.onerror = rej
    r.readAsText(file)
  })
}

interface Props {
  onStart: () => void
  onBack:  () => void
}

export default function QuarterSetupPage({ onStart, onBack }: Props) {
  const loadQuarter = useStore(s => s.loadQuarter)
  const setVideoUrl = useStore(s => s.setVideoUrl)
  const quarterMeta = useStore(s => s.quarterMeta)
  const videoUrl    = useStore(s => s.videoUrl)
  const theme       = useStore(s => s.theme)
  const toggleTheme = useStore(s => s.toggleTheme)

  const [quarterName, setQuarterName] = useState<string | null>(null)
  const [videoName,   setVideoName]   = useState<string | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const quarterInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef   = useRef<HTMLInputElement>(null)

  const quarterLoaded = quarterMeta !== null
  const canStart      = quarterLoaded

  const handleQuarter = async (file: File) => {
    if (!file.name.endsWith('.json')) { setError('Quarter file must be a .json file'); return }
    setLoading(true); setError(null)
    try {
      const text = await readFile(file)
      loadQuarter(text, file.name)
      setQuarterName(file.name)
    } catch (e) {
      setError(`Failed to load quarter data: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  const handleVideo = (file: File) => {
    if (!file.type.startsWith('video/')) { setError('Please select a video file'); return }
    setVideoUrl(URL.createObjectURL(file)); setVideoName(file.name); setError(null)
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg-page)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          position: 'fixed', top: 12, right: 16,
          background: 'var(--bg-panel)', color: 'var(--text-3)',
          border: '1px solid var(--border)', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer', fontSize: 14,
        }}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <div style={{
        width: 520, background: 'var(--bg-panel)',
        borderRadius: 12, border: '1px solid var(--border)',
        padding: '36px 40px', display: 'flex', flexDirection: 'column', gap: 28,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: 'var(--text-3)',
              cursor: 'pointer', fontSize: 18, padding: '0 4px 0 0', lineHeight: 1,
              marginTop: 3,
            }}
          >
            ←
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
              📋 Annotate Quarter
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-4)' }}>
              Load a quarter JSON tracking file to begin
            </div>
          </div>
        </div>

        <UploadStep
          number={1} title="Quarter Tracking JSON" required
          status={quarterLoaded ? 'loaded' : loading ? 'loading' : 'empty'}
          statusLabel={quarterLoaded ? (quarterName ?? quarterMeta?.filename) : undefined}
          hint="{gameId}_Q{quarter}.json  ·  NBA SportVU tracking data"
          dropLabel="Drop quarter JSON here or click"
          accept=".json" inputRef={quarterInputRef} onFile={handleQuarter}
        />

        <UploadStep
          number={2} title="Game Video" required={false}
          status={videoUrl ? 'loaded' : 'empty'}
          statusLabel={videoName ?? undefined}
          hint="Optional — mp4, mov, etc.  You can also load it later"
          dropLabel="Drop video file here or click"
          accept="video/*" inputRef={videoInputRef} onFile={handleVideo}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent-danger)', padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            {error}
          </div>
        )}

        <button
          disabled={!canStart || loading}
          onClick={onStart}
          style={{
            padding: '12px 0', borderRadius: 6, border: 'none',
            background: canStart && !loading ? 'var(--accent)' : 'var(--bg-surface)',
            color: canStart && !loading ? 'white' : 'var(--text-4)',
            fontSize: 15, fontWeight: 600,
            cursor: canStart && !loading ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          {loading ? 'Loading...' : canStart ? 'Start Annotating →' : 'Load quarter JSON to continue'}
        </button>
      </div>
    </div>
  )
}

// ── Reusable upload step ───────────────────────────────────────────────────

interface StepProps {
  number: number
  title: string
  required: boolean
  status: 'empty' | 'loaded' | 'loading'
  statusLabel?: string
  hint: string
  dropLabel: string
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (f: File) => void
}

function UploadStep({ number, title, required, status, statusLabel, hint, dropLabel, accept, inputRef, onFile }: StepProps) {
  const [dragOver, setDragOver] = useState(false)
  const loaded = status === 'loaded'
  const loading = status === 'loading'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: loaded ? 'var(--accent-success-bg)' : 'var(--bg-inter)',
          border: `1px solid ${loaded ? 'var(--accent-success)' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: loaded ? 'var(--accent-success)' : 'var(--text-3)',
          flexShrink: 0,
        }}>
          {loaded ? '✓' : number}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        {!required && <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 2 }}>(optional)</span>}
        {statusLabel && (
          <span style={{ fontSize: 11, color: 'var(--accent-success)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {statusLabel}
          </span>
        )}
      </div>

      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 56, borderRadius: 6, cursor: loading ? 'wait' : 'pointer',
          background: dragOver ? 'var(--bg-surface)' : (loaded ? 'var(--bg-inter)' : 'var(--bg-page)'),
          border: dragOver
            ? '1.5px solid var(--accent)'
            : loaded ? '1.5px solid var(--accent-success-bg)' : '1.5px dashed var(--border)',
          fontSize: 12,
          color: loaded ? 'var(--accent-success)' : 'var(--text-3)',
          gap: 8, transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 16 }}>{loaded ? '✓' : loading ? '⏳' : '⬆'}</span>
        <span>{loaded ? 'Loaded — drop to replace' : loading ? 'Parsing...' : dropLabel}</span>
        <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
      </label>

      <div style={{ fontSize: 11, color: 'var(--text-4)', paddingLeft: 30 }}>{hint}</div>
    </div>
  )
}
