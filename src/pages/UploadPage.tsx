import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

const PDATA_KEY = 'pdata_csv'
const PDATA_NAME_KEY = 'pdata_name'

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
  onSplit: () => void
}

export default function UploadPage({ onStart, onSplit }: Props) {
  const loadPlayerDict = useStore(s => s.loadPlayerDict)
  const loadPossession = useStore(s => s.loadPossession)
  const setVideoUrl    = useStore(s => s.setVideoUrl)
  const playerDict     = useStore(s => s.playerDict)
  const possession     = useStore(s => s.possession)
  const videoUrl       = useStore(s => s.videoUrl)
  const theme          = useStore(s => s.theme)
  const toggleTheme    = useStore(s => s.toggleTheme)

  const [pdataName, setPdataName]         = useState<string | null>(null)
  const [pdataCached, setPdataCached]     = useState(false)
  const [possessionName, setPossessionName] = useState<string | null>(null)
  const [videoName, setVideoName]         = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const pdataInputRef     = useRef<HTMLInputElement>(null)
  const possessionInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef     = useRef<HTMLInputElement>(null)

  const playerLoaded    = Object.keys(playerDict).length > 0
  const possessionLoaded = possession !== null
  const canStart        = playerLoaded && possessionLoaded

  useEffect(() => {
    if (playerLoaded) {
      const name = localStorage.getItem(PDATA_NAME_KEY) ?? 'player_data.csv'
      setPdataName(name); setPdataCached(true); return
    }
    const cached = localStorage.getItem(PDATA_KEY)
    const name   = localStorage.getItem(PDATA_NAME_KEY) ?? 'player_data.csv'
    if (cached) {
      try { loadPlayerDict(cached); setPdataName(name); setPdataCached(true) }
      catch { localStorage.removeItem(PDATA_KEY); localStorage.removeItem(PDATA_NAME_KEY) }
    }
  }, []) // eslint-disable-line

  useEffect(() => { if (possession && !possessionName) setPossessionName(possession.filename) }, [possession]) // eslint-disable-line
  useEffect(() => { if (videoUrl && !videoName) setVideoName('(loaded)') }, [videoUrl]) // eslint-disable-line

  const handlePdata = async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('player_data must be a .csv file'); return }
    try {
      const text = await readFile(file)
      loadPlayerDict(text)
      localStorage.setItem(PDATA_KEY, text); localStorage.setItem(PDATA_NAME_KEY, file.name)
      setPdataName(file.name); setPdataCached(false); setError(null)
    } catch (e) { setError(`Failed to load player data: ${e}`) }
  }

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

  const clearPdataCache = () => {
    localStorage.removeItem(PDATA_KEY); localStorage.removeItem(PDATA_NAME_KEY)
    setPdataName(null); setPdataCached(false)
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'var(--bg-page)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Theme toggle — top right */}
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
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
            🏀 NBA Guard Annotation
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-4)' }}>
            Load data to begin annotating defensive assignments
          </div>
        </div>

        <UploadStep
          number={1} title="Player Database" required
          status={playerLoaded ? 'loaded' : 'empty'}
          statusLabel={playerLoaded ? (pdataCached ? `${pdataName} · cached` : (pdataName ?? 'Loaded')) : undefined}
          hint="Loaded once — auto-cached in browser"
          dropLabel="Drop player_data.csv here or click"
          accept=".csv" inputRef={pdataInputRef} onFile={handlePdata}
          rightAction={pdataCached
            ? <button onClick={clearPdataCache} style={clearBtnStyle}>Clear cache</button>
            : undefined}
        />

        <UploadStep
          number={2} title="Possession Tracking" required
          status={possessionLoaded ? 'loaded' : 'empty'}
          statusLabel={possessionLoaded ? (possessionName ?? possession?.filename) : undefined}
          hint="{gameId}_{quarter}_{possessionIndex}.csv  ·  25 FPS tracking"
          dropLabel="Drop possession CSV here or click"
          accept=".csv" inputRef={possessionInputRef} onFile={handlePossession}
        />

        <UploadStep
          number={3} title="Game Video" required={false}
          status={videoUrl ? 'loaded' : 'empty'}
          statusLabel={videoName ?? undefined}
          hint="Optional — mp4, mov, etc.  You can also load it later"
          dropLabel="Drop video file here or click"
          accept="video/*" inputRef={videoInputRef} onFile={handleVideo}
        />

        {error && (
          <div style={{ fontSize: 12, color: '#e05c5c', padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            {error}
          </div>
        )}

        <button
          disabled={!canStart}
          onClick={onStart}
          style={{
            padding: '12px 0', borderRadius: 6, border: 'none',
            background: canStart ? '#4a90d9' : 'var(--bg-surface)',
            color: canStart ? 'white' : 'var(--text-4)',
            fontSize: 15, fontWeight: 600,
            cursor: canStart ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
          }}
        >
          {canStart ? 'Start Annotating →' : 'Load player data + possession to continue'}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>tools</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button
          onClick={onSplit}
          style={{
            padding: '9px 0', borderRadius: 6,
            background: 'var(--bg-surface)', color: 'var(--text-2)',
            border: '1px solid var(--border)', fontSize: 13, fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          ✂ Video Quarter Splitter
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
  rightAction?: React.ReactNode
}

function UploadStep({ number, title, required, status, statusLabel, hint, dropLabel, accept, inputRef, onFile, rightAction }: StepProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: status === 'loaded' ? '#3a7a3a' : 'var(--bg-inter)',
          border: `1px solid ${status === 'loaded' ? '#5cb85c' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: status === 'loaded' ? '#5cb85c' : 'var(--text-3)',
          flexShrink: 0,
        }}>
          {status === 'loaded' ? '✓' : number}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{title}</span>
        {!required && <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 2 }}>(optional)</span>}
        {statusLabel && (
          <span style={{ fontSize: 11, color: '#5cb85c', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {statusLabel}
          </span>
        )}
        {rightAction && <span style={{ marginLeft: 'auto' }}>{rightAction}</span>}
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
            ? '1.5px solid #4a90d9'
            : status === 'loaded'
              ? '1.5px solid #3a7a3a'
              : `1.5px dashed var(--border)`,
          fontSize: 12,
          color: status === 'loaded' ? '#5cb85c' : 'var(--text-3)',
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

const clearBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
  padding: '1px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
}
