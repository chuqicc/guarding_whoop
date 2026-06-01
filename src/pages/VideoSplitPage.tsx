import { useEffect, useRef, useState } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function toHMS(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = (s % 60).toFixed(3)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec.padStart(6,'0')}`
}

function parseHMS(str: string): number | null {
  const clean = str.trim()
  if (!clean) return null
  const parts = clean.split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]
  if (parts.length === 2) return parts[0]*60 + parts[1]
  return parts[0]
}

function fmtMSS(s: number | null): string {
  if (s === null || !isFinite(s) || s < 0) return '--:--'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2,'0')}`
}

function fmtSize(bytes: number): string {
  if (bytes > 1e9) return `${(bytes/1e9).toFixed(1)} GB`
  return `${(bytes/1e6).toFixed(0)} MB`
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface QuarterMark {
  label:    string
  start:    number | null
  end:      number | null
  startStr: string
  endStr:   string
}

type QuarterStatus = 'idle' | 'splitting' | 'done' | 'error'

const INIT_QUARTERS: QuarterMark[] = ['Q1','Q2','Q3','Q4'].map(label => ({
  label, start: null, end: null, startStr: '', endStr: '',
}))

// ── Component ─────────────────────────────────────────────────────────────────
const VIDEO_MIN_H = 120
const VIDEO_MAX_H = 800
const VIDEO_DEFAULT_H = 300

export default function VideoSplitPage({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Video panel height (resizable)
  const [videoPx, setVideoPx] = useState(VIDEO_DEFAULT_H)

  // Server health
  const [serverOk, setServerOk]     = useState<boolean | null>(null)

  // Video file
  const [videoFile,   setVideoFile]   = useState<File | null>(null)
  const [videoUrl,    setVideoUrl]    = useState<string | null>(null)
  const [vidTime,     setVidTime]     = useState(0)
  const [vidDuration, setVidDuration] = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [dragOver,    setDragOver]    = useState(false)

  // Upload
  const [uploadState,    setUploadState]    = useState<'idle'|'uploading'|'ready'|'error'>('idle')
  const [uploadPct,      setUploadPct]      = useState(0)
  const [uploadId,       setUploadId]       = useState<string | null>(null)
  const [uploadExt,      setUploadExt]      = useState<string>('mp4')

  // Quarters
  const [quarters,   setQuarters]   = useState<QuarterMark[]>(INIT_QUARTERS)

  // Split
  const [splitting,   setSplitting]   = useState(false)
  const [qStatus,     setQStatus]     = useState<Record<string, QuarterStatus>>({})
  const [qPct,        setQPct]        = useState<Record<string, number>>({})
  const [errors,      setErrors]      = useState<Record<string, string>>({})
  const [doneCount,   setDoneCount]   = useState(0)

  // ── Check server on mount ─────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => setServerOk(true))
      .catch(() => setServerOk(false))
  }, [])

  // ── Video element events ──────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime     = () => setVidTime(vid.currentTime)
    const onDuration = () => setVidDuration(vid.duration || 0)
    const onPlay     = () => setIsPlaying(true)
    const onPause    = () => setIsPlaying(false)
    vid.addEventListener('timeupdate',     onTime)
    vid.addEventListener('durationchange', onDuration)
    vid.addEventListener('play',           onPlay)
    vid.addEventListener('pause',          onPause)
    return () => {
      vid.removeEventListener('timeupdate',     onTime)
      vid.removeEventListener('durationchange', onDuration)
      vid.removeEventListener('play',           onPlay)
      vid.removeEventListener('pause',          onPause)
    }
  }, [videoUrl])

  // ── Load video locally for preview ───────────────────────────────────────
  const loadFile = (file: File) => {
    if (!file.type.startsWith('video/')) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setVidTime(0); setVidDuration(0); setIsPlaying(false)
    setUploadState('idle'); setUploadPct(0); setUploadId(null)
    setQStatus({}); setQPct({}); setErrors({}); setDoneCount(0)
  }

  // ── Upload to local server ────────────────────────────────────────────────
  const uploadFile = () => {
    if (!videoFile || !serverOk) return
    setUploadState('uploading'); setUploadPct(0)
    const ext = videoFile.name.split('.').pop() ?? 'mp4'
    setUploadExt(ext)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.setRequestHeader('x-ext', ext)

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) setUploadPct(Math.round(e.loaded / e.total * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 200) {
        const { id } = JSON.parse(xhr.responseText)
        setUploadId(id); setUploadState('ready')
      } else {
        setUploadState('error')
      }
    }
    xhr.onerror = () => setUploadState('error')
    xhr.send(videoFile)
  }

  // ── Quarter helpers ───────────────────────────────────────────────────────
  const setEdge = (idx: number, edge: 'start' | 'end') => {
    const t   = videoRef.current?.currentTime ?? vidTime
    const str = toHMS(t)
    setQuarters(prev => prev.map((q, i) =>
      i !== idx ? q
      : edge === 'start' ? { ...q, start: t, startStr: str }
                         : { ...q, end:   t, endStr:   str }
    ))
  }

  const handleInput = (idx: number, edge: 'start' | 'end', val: string) => {
    const parsed = parseHMS(val)
    setQuarters(prev => prev.map((q, i) =>
      i !== idx ? q
      : edge === 'start' ? { ...q, startStr: val, start: parsed }
                         : { ...q, endStr:   val, end:   parsed }
    ))
  }

  const seekTo = (t: number | null) => {
    if (t !== null && videoRef.current) videoRef.current.currentTime = t
  }

  // ── Video panel resize ────────────────────────────────────────────────────
  const onVideoDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY  = e.clientY
    const startH  = videoPx
    const onMove  = (mv: MouseEvent) => {
      const next = Math.min(VIDEO_MAX_H, Math.max(VIDEO_MIN_H, startH + mv.clientY - startY))
      setVideoPx(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor     = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor     = 'row-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }

  const validQuarters = quarters.filter(
    q => q.start !== null && q.end !== null && q.end > q.start
  )

  // ── Split via SSE ─────────────────────────────────────────────────────────
  const handleSplit = async () => {
    if (!uploadId || validQuarters.length === 0) return
    setSplitting(true)
    setDoneCount(0)
    setErrors({})
    setQStatus(Object.fromEntries(validQuarters.map(q => [q.label, 'idle'])))
    setQPct(Object.fromEntries(validQuarters.map(q => [q.label, 0])))

    const baseName = videoFile?.name.replace(/\.[^.]+$/, '') ?? 'video'

    const res = await fetch('/api/split', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id:  uploadId,
        ext: uploadExt,
        quarters: validQuarters.map(q => ({ label: q.label, startStr: q.startStr || toHMS(q.start!), endStr: q.endStr || toHMS(q.end!) })),
      }),
    })

    // Read SSE stream
    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()
    let   buf     = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const evt = JSON.parse(line.slice(5).trim())

          if (evt.type === 'quarter_start') {
            setQStatus(s => ({ ...s, [evt.quarter]: 'splitting' }))
          }
          if (evt.type === 'quarter_progress') {
            setQPct(p => ({ ...p, [evt.quarter]: evt.pct }))
          }
          if (evt.type === 'quarter_done') {
            setQStatus(s => ({ ...s, [evt.quarter]: 'done' }))
            setQPct(p => ({ ...p, [evt.quarter]: 100 }))
            setDoneCount(n => n + 1)
            // Trigger download via anchor
            const a = document.createElement('a')
            a.href = `/api/download/${evt.downloadKey}`
            a.download = `${baseName}_${evt.quarter}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          }
          if (evt.type === 'quarter_error') {
            setQStatus(s => ({ ...s, [evt.quarter]: 'error' }))
            setErrors(e => ({ ...e, [evt.quarter]: evt.message }))
          }
        } catch { /* skip malformed */ }
      }
    }

    setSplitting(false)
  }

  // ── FFmpeg commands (fallback reference) ──────────────────────────────────
  const ffmpegCmds = validQuarters.map(q => {
    const name = videoFile?.name ?? 'input.mp4'
    const base = name.replace(/\.[^.]+$/, '')
    const s = q.startStr || toHMS(q.start!)
    const e = q.endStr   || toHMS(q.end!)
    return `ffmpeg -i "${name}" -ss ${s} -to ${e} -c copy "${base}_${q.label}.mp4"`
  }).join('\n')

  const canSplit = !!uploadId && validQuarters.length > 0 && !splitting

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ height:'100vh', background:'var(--bg-page)', display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{ height:40, background:'var(--bg-panel)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 14px', gap:12, flexShrink:0 }}>
        <button onClick={onBack} style={btn()}>← Back</button>
        <span style={{ fontWeight:600, fontSize:14, color:'var(--text-1)' }}>Video Quarter Splitter</span>

        {/* Server status */}
        <span style={{ fontSize:11, color: serverOk === true ? '#5cb85c' : serverOk === false ? '#e05c5c' : 'var(--text-4)', marginLeft:8 }}>
          {serverOk === null  ? '⏳ Checking server…'
           : serverOk         ? '✓ Split server ready'
                              : '✗ Split server offline — run: npm run dev'}
        </span>

        {videoFile && (
          <span style={{ fontSize:11, color:'var(--text-3)', marginLeft:'auto' }}>
            {videoFile.name} · {fmtSize(videoFile.size)}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', gap:0 }}>

        {/* ── Video drop / player ── */}
        <div style={{ background:'var(--bg-video)', borderBottom:'1px solid var(--border)', height: videoPx, flexShrink:0, position:'relative', display:'flex', flexDirection:'column' }}>
          {videoUrl ? (
            <>
              <video ref={videoRef} src={videoUrl} controls={false}
                style={{ flex:1, width:'100%', objectFit:'contain', background:'#000', minHeight:0 }} />
              <div style={{ flexShrink:0, background:'var(--bg-surface)', borderTop:'1px solid var(--border)', padding:'5px 12px', display:'flex', alignItems:'center', gap:8 }}>
                <button onClick={() => { const v = videoRef.current; if (!v) return; isPlaying ? v.pause() : v.play() }}
                  style={{ ...btn(), width:28, height:28, fontSize:13 }}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                {([-10,-5,-1,1,5,10] as const).map(d => (
                  <button key={d} onClick={() => { if (videoRef.current) videoRef.current.currentTime += d }}
                    style={{ ...btn(), padding:'2px 5px', fontSize:10 }}>
                    {d>0?`+${d}s`:`${d}s`}
                  </button>
                ))}
                <input type="range" min={0} max={vidDuration||1} step={0.1} value={vidTime}
                  onChange={e => { const t=Number(e.target.value); setVidTime(t); if(videoRef.current) videoRef.current.currentTime=t }}
                  style={{ flex:1, accentColor:'#e05c5c' }} />
                <span style={{ fontSize:11, color:'var(--text-2)', minWidth:120, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>
                  {toHMS(vidTime).slice(0,-4)} / {toHMS(vidDuration).slice(0,-4)}
                </span>
              </div>
            </>
          ) : (
            <label
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if(f) loadFile(f) }}
              style={{
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                flex:1, cursor:'pointer',
                background: dragOver ? 'var(--bg-surface)' : 'var(--bg-video)',
                border:`2px dashed ${dragOver ? '#4a90d9' : 'var(--border)'}`,
                margin:12, borderRadius:8, gap:8, transition:'all 0.15s',
              }}>
              <span style={{ fontSize:32 }}>🎬</span>
              <span style={{ fontSize:13, color:'var(--text-2)', fontWeight:600 }}>Drop game video here</span>
              <span style={{ fontSize:11, color:'var(--text-4)' }}>or click to browse · mp4, mov, mkv …</span>
              <input type="file" accept="video/*" style={{ display:'none' }}
                onChange={e => { if(e.target.files?.[0]) loadFile(e.target.files[0]) }} />
            </label>
          )}

          {/* ── Resize handle ── */}
          <div
            onMouseDown={onVideoDividerMouseDown}
            title="Drag to resize video panel"
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: 6, cursor: 'row-resize', zIndex: 10,
              background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ width: 48, height: 3, borderRadius: 2, background: 'var(--border)' }} />
          </div>
        </div>

        {/* ── Upload to server ── */}
        {videoFile && (
          <div style={{ background:'var(--bg-panel)', borderBottom:'1px solid var(--border)', padding:'8px 16px', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:12, color:'var(--text-3)' }}>Step 1 — upload to split server:</span>

            {uploadState === 'idle' && (
              <button onClick={uploadFile} disabled={!serverOk} style={{ ...btn('#1e3a6e'), color:'#88bbff', padding:'4px 14px', fontSize:12 }}>
                ⬆ Upload ({fmtSize(videoFile.size)})
              </button>
            )}
            {uploadState === 'uploading' && (
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:160, height:8, background:'var(--bg-inter)', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ width:`${uploadPct}%`, height:'100%', background:'#4a90d9', transition:'width 0.2s' }} />
                </div>
                <span style={{ fontSize:11, color:'var(--text-3)' }}>{uploadPct}%</span>
              </div>
            )}
            {uploadState === 'ready' && (
              <span style={{ fontSize:12, color:'#5cb85c' }}>✓ Uploaded — ready to split</span>
            )}
            {uploadState === 'error' && (
              <span style={{ fontSize:12, color:'#e05c5c' }}>✗ Upload failed</span>
            )}

            <span style={{ marginLeft:'auto', fontSize:11, color:'var(--text-4)' }}>
              File is saved to a temp folder on your machine and deleted after download.
            </span>
          </div>
        )}

        {/* ── Quarter table ── */}
        <div style={{ background:'var(--bg-panel)', padding:'12px 16px 8px', flexShrink:0 }}>
          <div style={{ fontSize:11, color:'var(--text-4)', marginBottom:8 }}>
            Step 2 — mark quarter start / end times:
            <span style={{ color:'var(--text-3)', marginLeft:8 }}>
              Play video to the right moment → click <strong style={{ color:'var(--text-2)' }}>⊙ Set</strong>.
              Click a timestamp to seek. You can also type manually (HH:MM:SS).
            </span>
          </div>

          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid var(--border)` }}>
                {['Quarter','Start','','End','','Duration','Progress',''].map((h,i) => (
                  <th key={i} style={{ padding:'4px 8px', textAlign:'left', fontSize:11, color:'var(--text-4)', fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarters.map((q, idx) => {
                const dur  = q.start !== null && q.end !== null && q.end > q.start ? q.end - q.start : null
                const st   = qStatus[q.label]
                const pct  = qPct[q.label] ?? 0
                const err  = errors[q.label]
                return (
                  <tr key={q.label} style={{ borderBottom:`1px solid var(--border-dim)` }}>
                    <td style={{ padding:'8px', fontWeight:700, color:'#4a90d9', fontSize:15, width:40 }}>{q.label}</td>

                    <td style={{ padding:'4px 6px' }}>
                      <input value={q.startStr}
                        onChange={e => handleInput(idx,'start',e.target.value)}
                        placeholder="HH:MM:SS"
                        onClick={() => seekTo(q.start)}
                        style={timeInput(q.start !== null)} />
                    </td>
                    <td style={{ padding:'4px 2px' }}>
                      <button onClick={() => setEdge(idx,'start')} style={{ ...btn('#1e3254'), fontSize:11, padding:'3px 8px' }}>⊙ Set</button>
                    </td>

                    <td style={{ padding:'4px 6px' }}>
                      <input value={q.endStr}
                        onChange={e => handleInput(idx,'end',e.target.value)}
                        placeholder="HH:MM:SS"
                        onClick={() => seekTo(q.end)}
                        style={timeInput(q.end !== null)} />
                    </td>
                    <td style={{ padding:'4px 2px' }}>
                      <button onClick={() => setEdge(idx,'end')} style={{ ...btn('#3a1e4e'), fontSize:11, padding:'3px 8px' }}>⊙ Set</button>
                    </td>

                    <td style={{ padding:'4px 12px', color: dur ? '#5cb85c' : 'var(--text-4)', fontSize:12, width:70, fontVariantNumeric:'tabular-nums' }}>
                      {fmtMSS(dur)}
                    </td>

                    {/* Progress bar */}
                    <td style={{ padding:'4px 8px', width:160 }}>
                      {st === 'splitting' && (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ flex:1, height:5, background:'var(--bg-inter)', borderRadius:3, overflow:'hidden' }}>
                            <div style={{ width:`${pct}%`, height:'100%', background:'#4a90d9', transition:'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize:10, color:'var(--text-3)', minWidth:28 }}>{pct}%</span>
                        </div>
                      )}
                      {st === 'done'  && <span style={{ fontSize:11, color:'#5cb85c' }}>✓ Downloaded</span>}
                      {st === 'error' && <span style={{ fontSize:11, color:'#e05c5c' }} title={err}>✗ Error</span>}
                    </td>

                    {/* Clear */}
                    <td style={{ padding:'4px', width:30 }}>
                      {(q.start !== null || q.end !== null) && (
                        <button onClick={() => setQuarters(prev => prev.map((x,i) => i!==idx ? x : {...x, start:null, end:null, startStr:'', endStr:''}))}
                          style={{ ...btn(), fontSize:10, padding:'2px 5px', color:'var(--text-4)' }}>✕</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── Split button & status ── */}
        <div style={{ background:'var(--bg-surface)', borderTop:'1px solid var(--border)', padding:'10px 16px', display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <button
              disabled={!canSplit}
              onClick={handleSplit}
              style={{
                ...btn(canSplit ? '#1e5a30' : undefined),
                color: canSplit ? '#7ed99e' : 'var(--text-4)',
                padding:'6px 18px', fontSize:13, fontWeight:600,
              }}>
              {splitting
                ? `⏳ Splitting… (${doneCount}/${validQuarters.length})`
                : `✂ Split & Download ${validQuarters.length > 0 ? `(${validQuarters.length} quarter${validQuarters.length>1?'s':''})` : ''}`}
            </button>

            {!uploadId && videoFile && (
              <span style={{ fontSize:11, color:'#c8860a' }}>↑ Upload the video first (Step 1)</span>
            )}
            {!videoFile && (
              <span style={{ fontSize:11, color:'var(--text-4)' }}>↑ Drop a video file above</span>
            )}
            {!splitting && doneCount > 0 && Object.values(errors).length === 0 && (
              <span style={{ fontSize:12, color:'#5cb85c' }}>✓ All {doneCount} quarters downloaded!</span>
            )}
          </div>

          {/* FFmpeg command reference */}
          {validQuarters.length > 0 && (
            <details style={{ marginTop:4 }}>
              <summary style={{ fontSize:11, color:'var(--text-4)', cursor:'pointer' }}>
                Show equivalent FFmpeg terminal commands
              </summary>
              <div style={{
                marginTop:6, background:'var(--bg-page)', border:'1px solid var(--border)',
                borderRadius:4, padding:'8px 10px', fontFamily:'monospace',
                fontSize:11, color:'var(--text-2)', whiteSpace:'pre', overflowX:'auto',
              }}>
                {ffmpegCmds}
              </div>
              <button onClick={() => navigator.clipboard.writeText(ffmpegCmds)}
                style={{ ...btn(), marginTop:4, fontSize:10, padding:'2px 8px' }}>
                📋 Copy
              </button>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function btn(bg?: string): React.CSSProperties {
  return {
    background: bg ?? 'var(--bg-inter)', color: 'var(--text-2)',
    border: '1px solid var(--border)', borderRadius: 4,
    padding: '3px 10px', cursor: 'pointer', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  }
}

function timeInput(filled: boolean): React.CSSProperties {
  return {
    background: 'var(--bg-input)', color: 'var(--text-1)',
    border: `1px solid ${filled ? '#3a7a3a' : 'var(--border)'}`,
    borderRadius: 4, padding: '4px 8px', fontSize: 12,
    width: 110, fontVariantNumeric: 'tabular-nums',
  }
}
