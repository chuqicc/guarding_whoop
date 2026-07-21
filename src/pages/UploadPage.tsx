import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'

const PDATA_KEY      = 'pdata_csv'
const PDATA_NAME_KEY = 'pdata_name'

// Video Quarter Splitter entry — hidden for now (feature not needed)
const SHOW_VIDEO_SPLITTER = false

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = e => res(e.target!.result as string)
    r.onerror = rej
    r.readAsText(file)
  })
}

interface Props {
  onPossession: () => void
  onQuarter:    () => void
  onSplit:      () => void
}

export default function UploadPage({ onPossession:_onPossession, onQuarter, onSplit }: Props) {
  const loadPlayerDict = useStore(s => s.loadPlayerDict)
  const playerDict     = useStore(s => s.playerDict)
  const theme          = useStore(s => s.theme)
  const toggleTheme    = useStore(s => s.toggleTheme)

  const [pdataName,   setPdataName]   = useState<string | null>(null)
  const [pdataCached, setPdataCached] = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const pdataInputRef = useRef<HTMLInputElement>(null)
  const playerLoaded  = Object.keys(playerDict).length > 0

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

  const handlePdata = async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('player_data must be a .csv file'); return }
    try {
      const text = await readFile(file)
      loadPlayerDict(text)
      localStorage.setItem(PDATA_KEY, text); localStorage.setItem(PDATA_NAME_KEY, file.name)
      setPdataName(file.name); setPdataCached(false); setError(null)
    } catch (e) { setError(`Failed to load player data: ${e}`) }
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
        {/* Title */}
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
            🏀 NBA Guard Annotation
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-4)' }}>
            Choose an annotation mode
          </div>
        </div>

        {/* Player Database — shared across all modes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              background: playerLoaded ? 'var(--accent-success-bg)' : 'var(--bg-inter)',
              border: `1px solid ${playerLoaded ? 'var(--accent-success)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: playerLoaded ? 'var(--accent-success)' : 'var(--text-3)', flexShrink: 0,
            }}>
              {playerLoaded ? '✓' : '1'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Player Database</span>
            {playerLoaded && (
              <span style={{ fontSize: 11, color: 'var(--accent-success)', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                {pdataCached ? `${pdataName} · cached` : (pdataName ?? 'Loaded')}
              </span>
            )}
            {pdataCached && (
              <button onClick={clearPdataCache} style={clearBtnStyle}>Clear cache</button>
            )}
          </div>

          <PlayerDropZone playerLoaded={playerLoaded} inputRef={pdataInputRef} onFile={handlePdata} />
          <div style={{ fontSize: 11, color: 'var(--text-4)', paddingLeft: 30 }}>
            Loaded once — auto-cached in browser
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--accent-danger)', padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            {error}
          </div>
        )}

        {/* Video Quarter Splitter — hidden for now, flip to true to restore */}
        {SHOW_VIDEO_SPLITTER && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>tools</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <ModeButton
              icon="✂"
              label="Video Quarter Splitter"
              description="Split a full-game video into individual quarter clips"
              enabled={true}
              onClick={onSplit}
            />
          </>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>annotation modes</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* Mode: Annotate Quarter */}
        <ModeButton
          icon="📋"
          label="Annotate Quarter"
          description="Full-quarter defensive annotation on SportVU tracking"
          enabled={true}
          onClick={onQuarter}
        />

        {/* Mode: Annotate Ball Possession — not in use */}
        <ModeButton
          icon="🏀"
          label="Annotate Ball Possession"
          description="Per-possession defensive assignment on tracking data"
          enabled={false}
          disabledHint="Not currently in use"
        />
      </div>
    </div>
  )
}

// ── Player drop zone ───────────────────────────────────────────────────────

function PlayerDropZone({ playerLoaded, inputRef, onFile }: {
  playerLoaded: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (f: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <label
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 52, borderRadius: 6, cursor: 'pointer',
        background: dragOver ? 'var(--bg-surface)' : (playerLoaded ? 'var(--bg-inter)' : 'var(--bg-page)'),
        border: dragOver
          ? '1.5px solid var(--accent)'
          : playerLoaded ? '1.5px solid var(--accent-success-bg)' : '1.5px dashed var(--border)',
        fontSize: 12,
        color: playerLoaded ? 'var(--accent-success)' : 'var(--text-3)',
        gap: 8, transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 16 }}>{playerLoaded ? '✓' : '⬆'}</span>
      <span>{playerLoaded ? 'Loaded — drop to replace' : 'Drop player_data.csv here or click'}</span>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
    </label>
  )
}

// ── Mode button ────────────────────────────────────────────────────────────

function ModeButton({ icon, label, description, enabled, disabledHint, comingSoon, onClick }: {
  icon: string
  label: string
  description: string
  enabled: boolean
  disabledHint?: string
  comingSoon?: boolean
  onClick?: () => void
}) {
  return (
    <button
      disabled={!enabled || comingSoon}
      onClick={onClick}
      style={{
        padding: '14px 16px', borderRadius: 8, textAlign: 'left',
        border: `1px solid ${enabled && !comingSoon ? '#2e5a9a' : 'var(--border)'}`,
        background: enabled && !comingSoon ? '#1a2e50' : 'var(--bg-surface)',
        color: enabled && !comingSoon ? 'var(--text-1)' : 'var(--text-4)',
        cursor: enabled && !comingSoon ? 'pointer' : 'not-allowed',
        opacity: comingSoon ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: 14,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-4)' }}>
          {comingSoon ? 'Coming soon' : (!enabled && disabledHint) ? disabledHint : description}
        </span>
      </span>
      {enabled && !comingSoon && <span style={{ fontSize: 14, color: '#88bbff' }}>→</span>}
    </button>
  )
}

const clearBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text-3)',
  padding: '1px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
  marginLeft: 'auto',
}
