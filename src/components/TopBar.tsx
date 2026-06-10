import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import type { CellAnnotation } from '../store/useStore'

import { exportJSON, exportFrameCSV } from '../utils/export'
import { parseAnnotationCSV } from '../utils/importCSV'

interface Props {
  onNewSession: () => void
}

export default function TopBar({ onNewSession }: Props) {
  const theme              = useStore(s => s.theme)
  const toggleTheme        = useStore(s => s.toggleTheme)
  const possession         = useStore(s => s.possession)
  const quarterMeta        = useStore(s => s.quarterMeta)
  const mode               = useStore(s => s.mode)
  const frames             = useStore(s => s.frames)
  const currentFrame       = useStore(s => s.currentFrame)
  const cellAnnotations    = useStore(s => s.cellAnnotations)
  const deadTimeBuckets    = useStore(s => s.deadTimeBuckets)
  const playerDict         = useStore(s => s.playerDict)
  const setCellAnnotations = useStore(s => s.setCellAnnotations)
  const loadPossession     = useStore(s => s.loadPossession)
  const loadQuarter        = useStore(s => s.loadQuarter)

  const [error, setError] = useState<string | null>(null)
  const importRef         = useRef<HTMLInputElement>(null)
  const importCSVRef      = useRef<HTMLInputElement>(null)
  const swapRef           = useRef<HTMLInputElement>(null)

  const meta = possession ?? quarterMeta

  const frame     = frames[currentFrame]
  const shotClock = frame?.shotClock ?? null

  const defTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamA.abbr : meta.teamB.abbr)
    : null
  const attTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamB.abbr : meta.teamA.abbr)
    : null

  const canExport = !!meta  // allow export whenever tracking data is loaded

  const readFile = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = e => res(e.target!.result as string)
      r.onerror = rej
      r.readAsText(file)
    })

  const handleSwap = async (file: File) => {
    try {
      if (mode === 'quarter') {
        loadQuarter(await readFile(file), file.name)
      } else {
        loadPossession(await readFile(file), file.name)
      }
      setError(null)
    } catch (e) { setError(`Failed to load: ${e}`) }
  }

  const handleImportJSON = async (file: File) => {
    try {
      const data = JSON.parse(await readFile(file))
      const anns: CellAnnotation[] = data.pairs?.map((p: Record<string, unknown>) => ({
        id: (p.id as string) ?? String(Math.random()),
        defenderId: p.defender_id as number,
        attackerId: p.attacker_id === null ? 'GUARD_NONE' : p.attacker_id as number,
        shotClockBucket: p.shot_clock_second as number,
      })) ?? []
      setCellAnnotations(anns)
      setError(null)
    } catch (e) { setError(`Import failed: ${e}`) }
  }

  const handleImportCSV = async (file: File) => {
    try {
      const anns = parseAnnotationCSV(await readFile(file), mode === 'quarter')
      setCellAnnotations(anns)
      setError(null)
    } catch (e) { setError(`Import failed: ${e}`) }
  }

  const makeDrop = (handler: (f: File) => void) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop:     (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handler(f) },
  })

  const handleExportJSON = () => {
    if (!meta) return
    exportJSON(cellAnnotations, deadTimeBuckets, frames, meta, playerDict)
  }

  const handleExportFrameCSV = () => {
    if (!meta) return
    exportFrameCSV(cellAnnotations, deadTimeBuckets, frames, meta, playerDict)
  }

  return (
    <div style={{
      height: 40, background: 'var(--bg-panel)', display: 'flex', alignItems: 'center',
      padding: '0 10px', gap: 8, fontSize: 13, flexShrink: 0,
      borderBottom: '1px solid var(--border)',
    }}>

      {/* ── Left: navigation ── */}
      <button onClick={onNewSession} style={btnStyle(false)} title="Back to home">
        ← Home
      </button>

      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.03em' }}>
        {mode === 'quarter' ? 'Annotate Quarter' : 'Annotate Ball Possession'}
      </span>

      <div style={divider} />

      {/* ── Centre: data info ── */}
      {meta ? (
        <>
          <span style={{ color: '#aaa', fontSize: 12 }}>
            Game <strong style={{ color: '#ddd' }}>{meta.gameId}</strong>
          </span>
          <span style={{ color: '#aaa', fontSize: 12 }}>
            Q<strong style={{ color: '#ddd' }}>{meta.quarter}</strong>
          </span>
          {possession && (
            <span style={{ color: '#aaa', fontSize: 12 }}>
              Poss <strong style={{ color: '#ddd' }}>#{possession.possessionIndex}</strong>
            </span>
          )}
          <span style={{ fontSize: 12 }}>
            <strong style={{ color: '#4a90d9' }}>{defTeam}</strong>
            <span style={{ color: '#555' }}> DEF vs </span>
            <strong style={{ color: '#e05c5c' }}>{attTeam}</strong>
            <span style={{ color: '#555' }}> ATT</span>
          </span>
          {shotClock !== null && mode !== 'quarter' && (
            <span style={{ fontSize: 12, color: shotClock <= 5 ? '#e05c5c' : '#666' }}>
              Shot <strong style={{ color: shotClock <= 5 ? '#e05c5c' : '#aaa' }}>{shotClock.toFixed(1)}</strong>
            </span>
          )}
        </>
      ) : (
        <span style={{ color: '#444', fontSize: 12 }}>No data loaded</span>
      )}

      {/* ── Right: file actions ── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {error && (
          <span style={{ fontSize: 11, color: '#e05c5c', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={error}>
            ⚠ {error}
          </span>
        )}

        {cellAnnotations.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {cellAnnotations.length} cell{cellAnnotations.length !== 1 ? 's' : ''} · saved
          </span>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ ...btnStyle(false), fontSize: 13, padding: '2px 7px' }}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <div style={divider} />

        {/* Swap file */}
        <label {...makeDrop(handleSwap)} style={btnStyle(false)}
          title={mode === 'quarter' ? 'Load a different quarter JSON' : 'Load a different possession CSV'}>
          📂 {mode === 'quarter' ? 'Swap quarter' : 'Swap possession'}
          <input ref={swapRef} type="file"
            accept={mode === 'quarter' ? '.json' : '.csv'}
            style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handleSwap(e.target.files[0]) }} />
        </label>

        <div style={divider} />

        {/* Import JSON */}
        <label style={btnStyle(false)} title="Import previously exported JSON annotations">
          ⬆ Import JSON
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handleImportJSON(e.target.files[0]) }} />
        </label>

        {/* Import CSV */}
        <label style={btnStyle(false)} title="Import previously exported CSV annotations">
          ⬆ Import CSV
          <input ref={importCSVRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.[0]) handleImportCSV(e.target.files[0]) }} />
        </label>

        {/* Export JSON */}
        <button
          disabled={!canExport}
          onClick={handleExportJSON}
          style={btnStyle(canExport)}
          title="Export annotations as JSON"
        >
          ⬇ JSON
        </button>

        {/* Export per-frame CSV (main export format) */}
        <button
          disabled={!canExport}
          onClick={handleExportFrameCSV}
          style={btnStyle(canExport)}
          title="Export per-frame annotations: game_id, frame, moment_id, defender/attacker, gamestatus…"
        >
          ⬇ CSV
        </button>
      </div>
    </div>
  )
}

const divider: React.CSSProperties = {
  width: 1, height: 18, background: 'var(--border)', flexShrink: 0,
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--bg-surface)' : 'var(--bg-panel)',
    color: active ? '#88aadd' : 'var(--text-3)',
    border: `1px solid ${active ? '#2a3d5a' : 'var(--border)'}`,
    borderRadius: 4, padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
  }
}
