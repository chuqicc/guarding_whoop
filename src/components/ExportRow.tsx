import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { exportJSON, exportFrameCSV } from '../utils/export'
import { parseAnnotationCSV } from '../utils/importCSV'
import { parseAnnotationJSON } from '../utils/importJSON'

interface Props {
  onNewSession: () => void
}

export default function ExportRow({ onNewSession }: Props) {
  const possession        = useStore(s => s.possession)
  const mode              = useStore(s => s.mode)
  const frames            = useStore(s => s.frames)
  const cellAnnotations   = useStore(s => s.cellAnnotations)
  const deadTimeBuckets   = useStore(s => s.deadTimeBuckets)
  const shotBuckets       = useStore(s => s.shotBuckets)
  const reboundBuckets    = useStore(s => s.reboundBuckets)
  const restoreImported   = useStore(s => s.restoreImported)
  const playerDict        = useStore(s => s.playerDict)
  const setCellAnnotations = useStore(s => s.setCellAnnotations)
  const loadPossession   = useStore(s => s.loadPossession)
  const annotatorName    = useStore(s => s.annotatorName)
  const annotationSeconds = useStore(s => s.annotationSeconds)
  const notes             = useStore(s => s.notes)

  const [possessionFile, setPossessionFile] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const importInputRef     = useRef<HTMLInputElement>(null)
  const importCSVInputRef  = useRef<HTMLInputElement>(null)
  const possessionInputRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = e => res(e.target!.result as string)
      r.onerror = rej
      r.readAsText(file)
    })

  const handlePossessionFile = async (file: File) => {
    try {
      const text = await readFile(file)
      loadPossession(text, file.name)
      setPossessionFile(file.name)
      setError(null)
    } catch (e) { setError(`Failed to load possession: ${e}`) }
  }

  const handleImportJSON = async (file: File) => {
    try {
      const text = await readFile(file)
      const imported = parseAnnotationJSON(text, mode === 'quarter')
      restoreImported(imported)
      setError(null)
    } catch (e) { setError(`Failed to import annotations: ${e}`) }
  }

  const handleImportCSV = async (file: File) => {
    try {
      const text = await readFile(file)
      const anns = parseAnnotationCSV(text, mode === 'quarter')
      setCellAnnotations(anns)
      setError(null)
    } catch (e) { setError(`Failed to import annotations: ${e}`) }
  }

  const makeDrop = (handler: (f: File) => void) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handler(f) },
  })

  const canExport = !!possession && cellAnnotations.length > 0

  return (
    <div style={{
      background: '#1a1d27', borderTop: '1px solid #2a2d3a',
      padding: '5px 12px', display: 'flex', alignItems: 'center',
      gap: 8, flexShrink: 0, flexWrap: 'wrap',
    }}>
      {/* Quick-swap possession */}
      <label
        {...makeDrop(handlePossessionFile)}
        style={zoneBtnStyle(!!possessionFile)}
      >
        {possessionFile ? `📂 ${possessionFile}` : '📂 Swap possession'}
        <input ref={possessionInputRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) handlePossessionFile(e.target.files[0]) }} />
      </label>

      {/* Back to upload page */}
      <button onClick={onNewSession} style={actionBtnStyle(false)}>
        ← Upload page
      </button>

      <div style={{ width: 1, height: 20, background: '#2a2d3a' }} />

      {/* Import JSON annotations */}
      <label style={actionBtnStyle(false)}>
        ⬆ Import JSON
        <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) handleImportJSON(e.target.files[0]) }} />
      </label>

      {/* Import previously-exported CSV annotations */}
      <label style={actionBtnStyle(false)}>
        ⬆ Import CSV
        <input ref={importCSVInputRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.[0]) handleImportCSV(e.target.files[0]) }} />
      </label>

      {/* Export buttons */}
      <button disabled={!canExport}
        onClick={() => possession && exportJSON({ annotations: cellAnnotations, deadTimeBuckets, shotBuckets, reboundBuckets, frames, meta: possession, playerDict, annotatorName, annotationSeconds, notes })}
        style={actionBtnStyle(canExport)}>
        ⬇ JSON
      </button>
      <button disabled={!canExport}
        onClick={() => possession && exportFrameCSV({ annotations: cellAnnotations, deadTimeBuckets, shotBuckets, reboundBuckets, frames, meta: possession, playerDict, annotatorName, annotationSeconds, notes })}
        style={actionBtnStyle(canExport)}>
        ⬇ CSV
      </button>

      {/* Status */}
      <span style={{ fontSize: 11, color: '#444', marginLeft: 'auto' }}>
        {cellAnnotations.length > 0 && `${cellAnnotations.length} cell${cellAnnotations.length !== 1 ? 's' : ''} · auto-saved`}
      </span>

      {error && <span style={{ fontSize: 11, color: '#e05c5c', width: '100%' }}>{error}</span>}
    </div>
  )
}

function zoneBtnStyle(loaded: boolean): React.CSSProperties {
  return {
    background: '#1e2030',
    border: loaded ? '1px solid #2a5a2a' : '1px dashed #333',
    borderRadius: 4, padding: '3px 9px', cursor: 'pointer',
    fontSize: 11, color: loaded ? '#5cb85c' : '#666', whiteSpace: 'nowrap',
  }
}

function actionBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#1e2a3a' : '#1a1d27',
    color: active ? '#88aadd' : '#555',
    border: '1px solid #2a2d3a',
    borderRadius: 4, padding: '3px 9px', cursor: active ? 'pointer' : 'not-allowed',
    fontSize: 11, whiteSpace: 'nowrap',
  }
}
