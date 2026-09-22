import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

import { exportJSON, exportFrameCSV, exportNotesCSV } from '../utils/export'
import { fmtClock } from '../utils/timelineScale'
import { parseAnnotationCSV } from '../utils/importCSV'
import { parseAnnotationJSON } from '../utils/importJSON'
import { toggleBtnStyle } from '../utils/buttonStyle'
import { subscribeStorageStatus, type StorageStatus } from '../store/safeStorage'

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
  const quarterMeta        = useStore(s => s.quarterMeta)
  const frames             = useStore(s => s.frames)
  const currentFrame       = useStore(s => s.currentFrame)
  const cellAnnotations    = useStore(s => s.cellAnnotations)
  const deadTimeBuckets    = useStore(s => s.deadTimeBuckets)
  const deadSeedCount      = useStore(s => s.deadSeedCount)
  const deadSeedBuckets    = useStore(s => s.deadSeedBuckets)
  const noShotClockBuckets = useStore(s => s.noShotClockBuckets)
  const reseedDeadBuckets  = useStore(s => s.reseedDeadBuckets)
  const playerDict         = useStore(s => s.playerDict)
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

  // Surface persistence failures. Previously the indicator read "saved"
  // unconditionally, including on the paths that never wrote anything.
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({ state: 'ok' })
  useEffect(() => subscribeStorageStatus(setStorageStatus), [])
  const [notesOpen, setNotesOpen] = useState(false)
  const notesRef = useRef<HTMLDivElement>(null)
  const notesBtnRef = useRef<HTMLButtonElement>(null)
  // The popover is positioned fixed, not absolute: the top bar scrolls
  // horizontally when it overflows, and an overflow container clips any
  // absolutely-positioned child — which silently hid the whole popover.
  // (Setting overflow on one axis forces the other from `visible` to `auto`,
  // so there is no way to keep it inside and unclipped.)
  const [notesPos, setNotesPos] = useState<{ top: number; right: number } | null>(null)

  const placeNotes = () => {
    const r = notesBtnRef.current?.getBoundingClientRect()
    if (r) setNotesPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }

  // Close on an outside click or Escape. Without these the only way out was to
  // hit the toolbar toggle again — so people reached for the ✕ inside, which
  // deleted a note instead.
  useEffect(() => {
    if (!notesOpen) return
    placeNotes()
    // Follow the button if the layout moves underneath the open popover.
    const onMove = () => placeNotes()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    const onDown = (e: MouseEvent) => {
      if (!notesRef.current?.contains(e.target as Node)) setNotesOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotesOpen(false) }
    // Deferred: the click that opened the popover is still propagating.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [notesOpen])
  const [noteText, setNoteText]   = useState('')
  const [noteDefenderId, setNoteDefenderId] = useState<string>('')
  const importRef         = useRef<HTMLInputElement>(null)
  const importCSVRef      = useRef<HTMLInputElement>(null)
  const swapRef           = useRef<HTMLInputElement>(null)

  const meta = quarterMeta

  // Track annotation time while a quarter is loaded and the tab is visible
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

  const defTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamA.abbr : meta.teamB.abbr)
    : null
  const attTeam = meta
    ? (meta.defendingTeamId === meta.teamA.teamId ? meta.teamB.abbr : meta.teamA.abbr)
    : null

  const canExport = !!meta  // allow export whenever tracking data is loaded

  const currentBucket: number | null = frame
    ? Math.floor(frame.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
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
      loadQuarter(await readFile(file), file.name)
      setError(null)
    } catch (e) { setError(`Failed to load: ${e}`) }
  }

  const handleImportJSON = async (file: File) => {
    try {
      const imported = parseAnnotationJSON(await readFile(file))
      restoreImported(imported)
      setError(null)
    } catch (e) { setError(`Import failed: ${e}`) }
  }

  const handleImportCSV = async (file: File) => {
    try {
      // Same restore path as JSON, so Dead / Shot / Rebound come back too.
      restoreImported(parseAnnotationCSV(await readFile(file)))
      setError(null)
    } catch (e) { setError(`Import failed: ${e}`) }
  }

  const makeDrop = (handler: (f: File) => void) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop:     (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handler(f) },
  })

  const exportInput = meta ? {
    annotations: cellAnnotations, deadTimeBuckets, deadSeedBuckets, shotBuckets, reboundBuckets,
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
    // Reset the defender too. Leaving it set silently attributed every
    // following note to whoever was picked last — and since the list only
    // shows a jersey number, a wrong attribution is near-invisible afterwards.
    setNoteDefenderId('')
  }

  return (
    <div
      // The bar is a fixed-height flex row with no wrap, so on a narrow window
      // the right-hand actions used to be pushed off the edge and become
      // unreachable — export among them. Scrolling keeps everything available;
      // `data-scroll-x` stops the swipe chaining into browser history, which
      // would discard the loaded session (see index.css).
      data-scroll-x
      className="topbar"
      style={{
        height: 40, background: 'var(--bg-panel)', display: 'flex', alignItems: 'center',
        padding: '0 10px', gap: 8, fontSize: 13, flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto', overflowY: 'hidden',
      }}>

      {/* ── Left: navigation ── */}
      <button onClick={onNewSession} style={btnStyle(false)} title="Back to home">
        ← Home
      </button>

      <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.03em' }}>
        Annotate Quarter
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
          <span style={{ fontSize: 12 }}>
            <strong style={{ color: 'var(--accent)' }}>{defTeam}</strong>
            <span style={{ color: 'var(--text-3)' }}> DEF vs </span>
            <strong style={{ color: 'var(--accent-danger)' }}>{attTeam}</strong>
            <span style={{ color: 'var(--text-3)' }}> ATT</span>
          </span>
        </>
      ) : (
        <span style={{ color: 'var(--text-4)', fontSize: 12 }}>No data loaded</span>
      )}

      {/* ── Right: file actions ── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {error && (
          <span style={{ fontSize: 11, color: 'var(--accent-danger)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={error}>
            ⚠ {error}
          </span>
        )}

        {cellAnnotations.length > 0 && (
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: 11,
              fontWeight: storageStatus.state === 'failed' ? 700 : 400,
              color: storageStatus.state === 'failed' ? 'var(--accent-danger)' : 'var(--text-4)',
            }}
            title={storageStatus.state === 'failed' ? storageStatus.message : undefined}
          >
            {cellAnnotations.length} cell{cellAnnotations.length !== 1 ? 's' : ''}
            {storageStatus.state === 'failed' ? ' · ⚠ SAVE FAILED' : ' · saved'}
          </span>
        )}

        {storageStatus.state === 'failed' && (
          <span
            role="alert"
            style={{
              fontSize: 11, color: 'var(--accent-danger)', fontWeight: 600,
              maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
            title={storageStatus.message}
          >
            {storageStatus.message}
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

        {/* Dead-ball count, and the one-time seed that produced it */}
        {meta && (
          <span
            title={
              `${deadTimeBuckets.length} buckets marked dead.`
              + (deadSeedCount > 0
                ? ` ${deadSeedCount} were auto-marked from the tracking data when this file was first opened — review them against the video and clear any that are wrong.`
                : ' Auto-marking already ran for this file; your edits are kept.')
              + (noShotClockBuckets.length > 0
                ? ` ${noShotClockBuckets.length} buckets have no shot clock (hatched) and could not be judged automatically.`
                : '')
            }
            style={{ fontSize: 11, color: 'var(--text-4)' }}
          >
            ⏸ {deadTimeBuckets.length} dead
            {deadSeedCount > 0 && <> · <b style={{ color: 'var(--text-dead-active)' }}>{deadSeedCount} auto</b></>}
          </span>
        )}

        {/* Re-run the seeding. Destructive, so it asks. */}
        {meta && (
          <button
            onClick={() => {
              const ok = window.confirm(
                'Re-run auto-marking for dead balls?\n\n'
                + 'This DISCARDS every dead mark in this file — including the ones you '
                + 'added or cleared by hand — and derives them again from the tracking data.\n\n'
                + '⌘Z undoes it.',
              )
              if (ok) reseedDeadBuckets()
            }}
            title="Discard all dead marks and derive them again from the tracking data"
            style={{ ...btnStyle(false), fontSize: 11 }}
          >
            ⟳ Re-mark dead
          </button>
        )}

        {/* Notes popover */}
        <div style={{ position: 'relative' }}>
          <button
            ref={notesBtnRef}
            onClick={() => setNotesOpen(v => !v)}
            disabled={!meta}
            aria-label="Toggle notes"
            aria-expanded={notesOpen}
            style={btnStyle(notesOpen)}
            title="Timestamped notes for this file"
          >
            📝 Notes{notes.length > 0 ? ` (${notes.length})` : ''}
          </button>

          {notesOpen && meta && (
            <div ref={notesRef} style={{
              position: 'fixed',
              top: notesPos?.top ?? 44,
              right: notesPos?.right ?? 10,
              width: 280, maxHeight: 320, overflowY: 'auto',
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: 6, padding: 8, zIndex: 50,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', marginBottom: 6,
                paddingBottom: 4, borderBottom: '1px solid var(--border-dim)',
              }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  Notes{notes.length > 0 ? ` (${notes.length})` : ''}
                </span>
                {/* The ✕ people actually reach for. */}
                <button
                  onClick={() => setNotesOpen(false)}
                  title="Close notes (Esc)"
                  aria-label="Close notes"
                  style={{
                    marginLeft: 'auto', background: 'transparent', color: 'var(--text-3)',
                    border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px',
                  }}
                >✕</button>
              </div>

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
                        {fmtClock(n.bucket)}{def ? ` · #${def.jersey} ${def.name}` : ''}
                      </div>
                      <div>{n.text}</div>
                    </div>
                    {/* Not a ✕: that glyph now closes the popover, and having
                        both meant a mis-click destroyed a note. */}
                    <button
                      className="note-delete"
                      onClick={() => removeNote(n.id)}
                      title="Delete this note (⌘Z undoes it)"
                      aria-label={`Delete note: ${n.text.slice(0, 40)}`}
                      style={{
                        background: 'transparent', color: 'var(--text-4)',
                        border: 'none', cursor: 'pointer', fontSize: 12, padding: 0,
                      }}
                    >
                      🗑
                    </button>
                  </div>
                )
              })}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder={currentBucket !== null ? `Note at ${fmtClock(currentBucket)}…` : 'Note…'}
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
          title="Load a different quarter JSON">
          📂 Swap quarter
          <input ref={swapRef} type="file"
            accept=".json"
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
