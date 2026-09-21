import { useState } from 'react'
import type { AnnotationDocument } from '../utils/annotationDocument'

/**
 * Drop zone for one annotator's exported file. Shared by the compare page and
 * the dead-ball review page so the two stay consistent about what they accept
 * and what they show once a file is loaded.
 */
export default function AnnotationDropZone({ label, doc, error, onFile }: {
  label: string
  doc: AnnotationDocument | null
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
      {doc ? (
        <div style={{ fontSize: 12 }}>
          <strong style={{ fontSize: 14 }}>{doc.annotator || '(no annotator name in file)'}</strong>
          <div style={{ color: 'var(--text-3)', marginTop: 2 }}>
            {doc.gameId} · Q{doc.quarter} · {doc.buckets.size} buckets ·{' '}
            <span style={{ textTransform: 'uppercase' }}>{doc.sourceFormat}</span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: error ? 'var(--accent-danger)' : 'var(--text-3)' }}>
          {error ?? 'Drop an exported JSON or CSV here'}
        </div>
      )}
      <input
        type="file" accept=".json,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}
