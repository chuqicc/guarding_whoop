import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

import { exportJSON, exportFrameCSV, exportNotesCSV } from '../utils/export'
import { parseAnnotationCSV } from '../utils/importCSV'
import { parseAnnotationJSON } from '../utils/importJSON'
import { toggleBtnStyle } from '../utils/buttonStyle'

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

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
  const annotatorName      = useStore(s => s.annotatorName)
  const setAnnotatorName   = useStore(s => s.setAnnotatorName)
  const annotationSeconds  = useStore(s => s.annotationSeconds)
  const notes              = useStore(s => s.notes)
  const addNote            = useStore(s => s.addNote)
  const removeNote         = useStore(s => s.removeNote)
  const autoFillMemory     = useStore(s => s.autoFillMemory)
  const toggleAutoFillMemory = useStore(s => s.toggleAutoFillMemory)
  const shotBuckets        = useStore(s => s.shotBuckets)
  const reboundBuckets     = useStore(s => s.reboundBuckets)
  const restoreImported    = useStore(s => s.restoreImported)

  const [error, setError]       = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [noteText, setNoteText]   = useState('')
  const [noteDefenderId, setNoteDefenderId] = useState<string>('')
  const importRef         = useRef<HTMLInputElement>(null)
  const importCSVRef      = useRef<HTMLInputElement>(null)
  const swapRef           = useRef<HTMLInputElement>(null)

  const meta = possession ?? quarterMeta

  // Track annotation time while a quarter/possession is loaded and the tab is visible
  useEffect(() => {
    if (!meta) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        useStore.getState().incrementAnnotationTime(10)
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [meta])

  const frame     = frames[currentFrame]
  const shotClock = frame?.shotClock ?? null

  const defTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamA.abbr : meta.teamB.abbr)
    : null
  const attTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamB.abbr : meta.teamA.abbr)
    : null

  const canExport = !!meta  // allow export whenever tracking data is loaded

  const currentBucket: number | null = frame
    ? (mode === 'quarter'
        ? Math.floor(frame.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
        : (frame.shotClock !== null && !isNaN(frame.shotClock) ? Math.floor(frame.shotClock) : null))
    : null

  const onCourtIds    = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const defendingTeam = meta ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB) : null
  const defPlayers    = defendingTeam ? defendingTeam.players.filter(p => onCourtIds.has(p.id)) : []

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
      const imported = parseAnnotationJSON(await readFile(file), mode === 'quarter')
      restoreImported(imported)
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

  const exportInput = meta ? {
    annotations: cellAnnotations, deadTimeBuckets, shotBuckets, reboundBuckets,
    frames, meta, playerDict, annotatorName, annotationSeconds, notes,
  } : null

  const handleExportJSON = () => {
    if (exportInput) exportJSON(exportInput)
  }

  const handleExportFrameCSV = () => {
    if (exportInput) exportFrameCSV(exportInput)
  }

  const handleExportNotesCSV = () => {
    if (!meta) return
    exportNotesCSV(notes, meta, playerDict)
  }

  const handleAddNote = () => {
    if (!noteText.trim() || currentBucket === null) return
    addNote(currentBucket, noteText.trim(), noteDefenderId ? parseInt(noteDefenderId) : undefined)
    setNoteText('')
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
          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
            Game <strong style={{ color: 'var(--text-1)' }}>{meta.gameId}</strong>
          </span>
          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
            Q<strong style={{ color: 'var(--text-1)' }}>{meta.quarter}</strong>
          </span>
          {possession && (
            <span style={{ color: 'var(--text-2)', fontSize: 12 }}>
              Poss <strong style={{ color: 'var(--text-1)' }}>#{possession.possessionIndex}</strong>
            </span>
          )}
          <span style={{ fontSize: 12 }}>
            <strong style={{ color: 'var(--accent)' }}>{defTeam}</strong>
            <span style={{ color: 'var(--text-3)' }}> DEF vs </span>
            <strong style={{ color: 'var(--accent-danger)' }}>{attTeam}</strong>
            <span style={{ color: 'var(--text-3)' }}> ATT</span>
          </span>
          {shotClock !== null && mode !== 'quarter' && (
            <span style={{ fontSize: 12, color: shotClock <= 5 ? 'var(--accent-danger)' : 'var(--text-3)' }}>
              Shot <strong style={{ color: shotClock <= 5 ? 'var(--accent-danger)' : 'var(--text-2)' }}>{shotClock.toFixed(1)}</strong>
            </span>
          )}
        </>
      ) : (
        <span style={{ color: '#444', fontSize: 12 }}>No data loaded</span>
      )}

      {/* ── Right: file actions ── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {error && (
          <span style={{ fontSize: 11, color: 'var(--accent-danger)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={error}>
            ⚠ {error}
          </span>
        )}

        {cellAnnotations.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
            {cellAnnotations.length} cell{cellAnnotations.length !== 1 ? 's' : ''} · saved
          </span>
        )}

        {/* Annotator name */}
        <input
          value={annotatorName}
          onChange={e => setAnnotatorName(e.target.value)}
          placeholder="Annotator name"
          title="Your name — saved with exports for inter-annotator agreement tracking"
          style={{
            background: 'var(--bg-panel)', color: 'var(--text-2)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: '2px 6px', fontSize: 11, width: 100,
          }}
        />

        {/* Annotation time */}
        {meta && (
          <span title="Total time spent annotating this file" style={{ fontSize: 11, color: 'var(--text-4)' }}>
            ⏱ {fmtDuration(annotationSeconds)}
          </span>
        )}

        {/* Notes popover */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setNotesOpen(v => !v)}
            disabled={!meta}
            style={btnStyle(notesOpen)}
            title="Timestamped notes for this file"
          >
            📝 Notes{notes.length > 0 ? ` (${notes.length})` : ''}
          </button>

          {notesOpen && meta && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              width: 280, maxHeight: 320, overflowY: 'auto',
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: 6, padding: 8, zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {notes.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 6 }}>No notes yet.</div>
              )}
              {notes.map(n => {
                const def = n.defenderId !== undefined ? playerDict[n.defenderId] : null
                return (
                  <div key={n.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    fontSize: 11, color: 'var(--text-2)', marginBottom: 6,
                    borderBottom: '1px solid var(--border-dim)', paddingBottom: 6,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--text-4)', fontSize: 10 }}>
                        bucket {n.bucket}{def ? ` · #${def.jersey} ${def.name}` : ''}
                      </div>
                      <div>{n.text}</div>
                    </div>
                    <button
                      onClick={() => removeNote(n.id)}
                      title="Delete note"
                      style={{ background: 'transparent', color: 'var(--text-4)', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={currentBucket !== null ? `Note at bucket ${currentBucket}…` : 'Note…'}
                  rows={2}
                  style={{
                    background: 'var(--bg-cell)', color: 'var(--text-2)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    padding: '4px 6px', fontSize: 11, resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    value={noteDefenderId}
                    onChange={e => setNoteDefenderId(e.target.value)}
                    style={{
                      flex: 1, background: 'var(--bg-cell)', color: 'var(--text-2)',
                      border: '1px solid var(--border)', borderRadius: 4, fontSize: 11,
                    }}
                  >
                    <option value="">(no defender)</option>
                    {defPlayers.map(p => (
                      <option key={p.id} value={p.id}>#{p.jersey} {p.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddNote}
                    disabled={!noteText.trim() || currentBucket === null}
                    style={btnStyle(!!noteText.trim() && currentBucket !== null)}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={divider} />

        {/* Auto-fill memory toggle */}
        <button
          onClick={toggleAutoFillMemory}
          title={autoFillMemory
            ? 'Memory ON — new buckets auto-fill each defender\'s previous assignment. Click to disable.'
            : 'Memory OFF — buckets stay empty until you assign manually. Click to enable.'}
          style={btnStyle(autoFillMemory)}
        >
          🧠 Memory {autoFillMemory ? 'ON' : 'OFF'}
        </button>

        <div style={divider} />

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

        {/* Export notes CSV */}
        <button
          disabled={!canExport || notes.length === 0}
          onClick={handleExportNotesCSV}
          style={btnStyle(canExport && notes.length > 0)}
          title="Export timestamped notes as CSV"
        >
          ⬇ Notes
        </button>
      </div>
    </div>
  )
}

const divider: React.CSSProperties = {
  width: 1, height: 18, background: 'var(--border)', flexShrink: 0,
}

const btnStyle = toggleBtnStyle
