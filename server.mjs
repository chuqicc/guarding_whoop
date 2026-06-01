/**
 * Local split-server — runs alongside Vite dev server.
 * In production (NODE_ENV=production) also serves the built frontend from dist/.
 * Handles large video file uploads and FFmpeg-based quarter splitting.
 * Vite proxies /api/* → http://localhost:3001 so browser sees same origin.
 */
import express from 'express'
import cors from 'cors'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'child_process'
import { createWriteStream, createReadStream } from 'fs'
import { mkdir, unlink, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT      = process.env.PORT || 3001
const TEMP_DIR  = join(tmpdir(), 'nba-video-split')
await mkdir(TEMP_DIR, { recursive: true })

if (!ffmpegPath) {
  console.error('❌  ffmpeg-static could not locate an FFmpeg binary for this platform.')
  process.exit(1)
}
console.log(`✓  FFmpeg: ${ffmpegPath}`)

const app = express()
app.use(cors())

// ── Serve built frontend in production ─────────────────────────────────────
// DIST_DIR is injected by Electron main so it can point to resources/dist.
// Railway / plain-node production falls back to __dirname/dist.
if (process.env.NODE_ENV === 'production') {
  const distDir = process.env.DIST_DIR ?? join(__dirname, 'dist')
  app.use(express.static(distDir))
}

// ── GET /api/health ────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ffmpeg: ffmpegPath })
})

// ── POST /api/upload ───────────────────────────────────────────────────────
// Streams the raw request body (video file) to a temp file on disk.
// Header  x-ext : file extension without dot (e.g. "mp4")
// Returns { id, ext }
app.post('/api/upload', (req, res) => {
  const ext  = (req.headers['x-ext'] ?? 'mp4').replace(/^\./, '')
  const id   = randomUUID()
  const path = join(TEMP_DIR, `${id}.${ext}`)
  const ws   = createWriteStream(path)

  req.pipe(ws)

  ws.on('finish', () => {
    console.log(`  ↑ Saved: ${path}`)
    res.json({ id, ext })
  })
  ws.on('error', err => {
    console.error('  Upload write error:', err)
    res.status(500).json({ error: err.message })
  })
  req.on('error', err => {
    ws.destroy()
    console.error('  Upload request error:', err)
  })
})

// ── POST /api/split ────────────────────────────────────────────────────────
// Body JSON: { id, ext, quarters: [{ label, startStr, endStr }] }
// Responds with Server-Sent Events (text/event-stream).
// Event shapes:
//   { type:'quarter_start',    quarter }
//   { type:'quarter_progress', quarter, pct }
//   { type:'quarter_done',     quarter, downloadKey }
//   { type:'quarter_error',    quarter, message }
//   { type:'complete' }
app.post('/api/split', express.json(), async (req, res) => {
  const { id, ext, quarters } = req.body ?? {}
  if (!id || !quarters?.length) {
    return res.status(400).json({ error: 'Missing id or quarters' })
  }

  // SSE setup
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  })
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  const inPath = join(TEMP_DIR, `${id}.${ext ?? 'mp4'}`)
  try { await stat(inPath) } catch {
    send({ type: 'error', message: 'Upload not found — please re-upload.' })
    return res.end()
  }

  for (const q of quarters) {
    const key     = `${id}_${q.label}`
    const outPath = join(TEMP_DIR, `${key}.mp4`)

    send({ type: 'quarter_start', quarter: q.label })

    await new Promise(resolve => {
      const args = [
        '-i', inPath,
        '-ss', q.startStr,
        '-to', q.endStr,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-y', outPath,
      ]
      console.log(`  ✂  ${q.label}: ffmpeg -ss ${q.startStr} -to ${q.endStr}`)
      const proc = spawn(ffmpegPath, args)

      let totalSec  = 0
      proc.stderr.on('data', chunk => {
        const s = chunk.toString()
        // Parse total duration of the clip
        const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
        if (dm) totalSec = +dm[1]*3600 + +dm[2]*60 + +dm[3]
        // Parse current encode position
        const tm = s.match(/time=\s*(\d+):(\d+):(\d+\.\d+)/)
        if (tm && totalSec > 0) {
          const cur = +tm[1]*3600 + +tm[2]*60 + +tm[3]
          send({ type: 'quarter_progress', quarter: q.label, pct: Math.min(99, Math.round(cur/totalSec*100)) })
        }
      })

      proc.on('close', code => {
        if (code === 0) {
          console.log(`  ✓  ${q.label} done`)
          send({ type: 'quarter_done', quarter: q.label, downloadKey: key })
        } else {
          send({ type: 'quarter_error', quarter: q.label, message: `FFmpeg exit code ${code}` })
        }
        resolve()
      })
      proc.on('error', err => {
        send({ type: 'quarter_error', quarter: q.label, message: err.message })
        resolve()
      })
    })
  }

  // Cleanup input file
  unlink(inPath).catch(() => {})

  send({ type: 'complete' })
  res.end()
})

// ── GET /api/download/:key ─────────────────────────────────────────────────
// Streams the split file back; deletes it from disk when done.
app.get('/api/download/:key', async (req, res) => {
  const filePath = join(TEMP_DIR, `${req.params.key}.mp4`)
  try {
    const info = await stat(filePath)
    res.setHeader('Content-Type',        'video/mp4')
    res.setHeader('Content-Length',      info.size)
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.key.split('_').pop()}.mp4"`)
    createReadStream(filePath).pipe(res)
    res.on('finish', () => unlink(filePath).catch(() => {}))
  } catch {
    res.status(404).json({ error: 'File not found or already downloaded' })
  }
})

// ── SPA fallback (must be after all /api routes) ───────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distDir = process.env.DIST_DIR ?? join(__dirname, 'dist')
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(join(distDir, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`\n🏀  Split server → http://localhost:${PORT}\n`)
})
