import { useEffect, useRef, useState } from 'react'
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

export default function PossessionSetupPage({ onStart, onBack }: Props) {
  const loadPossession = useStore(s => s.loadPossession)
  const setVideoUrl    = useStore(s => s.setVideoUrl)
  const possession     = useStore(s => s.possession)
  const videoUrl       = useStore(s => s.videoUrl)
  const theme          = useStore(s => s.theme)
  const toggleTheme    = useStore(s => s.toggleTheme)

  const [possessionName, setPossessionName] = useState<string | null>(null)
  const [videoName, setVideoName]           = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)

  const possessionInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef      = useRef<HTMLInputElement>(null)

  const possessionLoaded = possession !== null
  const canStart         = possessionLoaded

  useEffect(() => {
    if (possession && !possessionName) setPossessionName(possession.filename)
  }, [possession]) // eslint-disable-line

  useEffect(() => {
    if (videoUrl && !videoName) setVideoName('(loaded)')
  }, [videoUrl]) // eslint-disable-line

  const handlePossession = async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('Possession file must be a .csv file'); return }
    try {
      loadPossession(await readFile(file), file.name)
      setPossessionName(file.name); setError(null)
    } catch (e) { setError(`Failed to load possession: ${e}`) }
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
              🏀 Annotate Ball Possession
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-4)' }}>
              Load possession tracking data to begin
            </div>
          </div>
        </div>

        <UploadStep
          number={1} title="Possession Tracking" required
          status={possessionLoaded ? 'loaded' : 'empty'}
          statusLabel={possessionLoaded ? (possessionName ?? possession?.filename) : undefined}
          hint="{gameId}_{quarter}_{possessionIndex}.csv  ·  25 FPS tracking"
          dropLabel="Drop possession CSV here or click"
          accept=".csv" inputRef={possessionInputRef} onFile={handlePossession}
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
          disabled={!canStart}
          onClick={onStart}
          style={{
            padding: '12px 0', borderRadius: 6, border: 'none',
            background: canStart ? 'var(--accent)' : 'var(--bg-surface)',
            color: canStart ? 'white' : 'var(--text-4)',
            fontSize: 15, fontWeight: 600,
            cursor: canStart ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          {canStart ? 'Start Annotating →' : 'Load possession tracking to continue'}
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
  status: 'empty' | 'loaded'
  statusLabel?: string
  hint: string
  dropLabel: string
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (f: File) => void
}

function UploadStep({ number, title, required, status, statusLabel, hint, dropLabel, accept, inputRef, onFile }: StepProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: status === 'loaded' ? 'var(--accent-success-bg)' : 'var(--bg-inter)',
          border: `1px solid ${status === 'loaded' ? 'var(--accent-success)' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: status === 'loaded' ? 'var(--accent-success)' : 'var(--text-3)',
          flexShrink: 0,
        }}>
          {status === 'loaded' ? '✓' : number}
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
          height: 56, borderRadius: 6, cursor: 'pointer',
          background: dragOver ? 'var(--bg-surface)' : (status === 'loaded' ? 'var(--bg-inter)' : 'var(--bg-page)'),
          border: dragOver
            ? '1.5px solid var(--accent)'
            : status === 'loaded'
              ? '1.5px solid var(--accent-success-bg)'
              : '1.5px dashed var(--border)',
          fontSize: 12,
          color: status === 'loaded' ? 'var(--accent-success)' : 'var(--text-3)',
          gap: 8, transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 16 }}>{status === 'loaded' ? '✓' : '⬆'}</span>
        <span>{status === 'loaded' ? 'Loaded — drop to replace' : dropLabel}</span>
        <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
      </label>

      <div style={{ fontSize: 11, color: 'var(--text-4)', paddingLeft: 30 }}>{hint}</div>
    </div>
  )
}
