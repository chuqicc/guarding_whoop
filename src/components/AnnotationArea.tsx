import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { COLOR_TEAM_A, COLOR_TEAM_B, QUARTER_BUCKET_S } from '../constants'

const CELL_W_POSS    = 58   // px per shot-clock second (possession mode)
const CELL_W_QUARTER = 36   // px per 1-second bucket (quarter mode)
const LABEL_W        = 160  // px for the sticky defender label column
const HEADER_H       = 68   // px for header row (three lines)
const ROW_H          = 44   // px per defender row
const DEAD_ROW_H     = 26   // px for the dead-time toggle row

function fmtClock(s: number): string {
  if (!isFinite(s)) return '--:--'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const half = Math.round(s % 1 * 10) === 5 ? '.5' : ''
  return `${m}:${String(sec).padStart(2, '0')}${half}`
}

export default function AnnotationArea() {
  const possession         = useStore(s => s.possession)
  const quarterMeta        = useStore(s => s.quarterMeta)
  const mode               = useStore(s => s.mode)
  const frames             = useStore(s => s.frames)
  const currentFrame       = useStore(s => s.currentFrame)
  const cellAnnotations    = useStore(s => s.cellAnnotations)
  const deadTimeBuckets    = useStore(s => s.deadTimeBuckets)
  const playerDict         = useStore(s => s.playerDict)
  const scrollRef          = useRef<HTMLDivElement>(null)

  const meta   = possession ?? quarterMeta
  const isQtr  = mode === 'quarter'
  const CELL_W = isQtr ? CELL_W_QUARTER : CELL_W_POSS

  if (!meta) {
    return (
      <div style={{ padding: 16, color: '#555', fontSize: 13 }}>
        Load tracking data to annotate
      </div>
    )
  }

  const defTeam = meta.defendingTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
  const defColor = defTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B

  // Only show defenders currently on the court
  const onCourtIds  = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const defPlayers  = defTeam.players.filter(p => onCourtIds.has(p.id))

  // ── Buckets ──────────────────────────────────────────────────────────────
  const getBucket = (qc: number, sc: number | null) =>
    isQtr
      ? Math.floor(qc / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
      : sc !== null && !isNaN(sc) ? Math.floor(sc) : null

  const buckets: number[] = isQtr
    ? [...new Set(frames.map(f => Math.floor(f.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S))]
        .sort((a, b) => b - a)
    : [...new Set(
        frames
          .filter(f => f.shotClock !== null && !isNaN(f.shotClock!))
          .map(f => Math.floor(f.shotClock!))
      )].sort((a, b) => b - a)

  // Per-bucket: representative quarter clock + first frame index
  const bucketQClock     = new Map<number, number>()
  const bucketFrameStart = new Map<number, number>()
  for (const f of frames) {
    const b = getBucket(f.quarterClock, f.shotClock)
    if (b === null) continue
    if (!bucketFrameStart.has(b) || f.frameIndex < bucketFrameStart.get(b)!) {
      bucketFrameStart.set(b, f.frameIndex)
    }
    if (!isQtr) {
      const cur = bucketQClock.get(b)
      if (cur === undefined || f.quarterClock > cur) bucketQClock.set(b, f.quarterClock)
    }
  }

  const frame = frames[currentFrame]
  const currentBucket: number | null = frame
    ? getBucket(frame.quarterClock, frame.shotClock)
    : null

  // Auto-scroll so current bucket column stays visible
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!scrollRef.current || currentBucket === null) return
    const idx = buckets.indexOf(currentBucket)
    if (idx === -1) return
    const container = scrollRef.current
    const x = LABEL_W + idx * CELL_W
    const { scrollLeft, clientWidth } = container
    if (x < scrollLeft + LABEL_W || x + CELL_W > scrollLeft + clientWidth) {
      container.scrollLeft = Math.max(0, x - LABEL_W - (clientWidth - LABEL_W - CELL_W) / 2)
    }
  }, [currentBucket]) // eslint-disable-line react-hooks/exhaustive-deps

  // Carry annotations forward: when entering an empty bucket, copy from nearest preceding bucket
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (currentBucket === null) return
    const { cellAnnotations, setCellAnnotation } = useStore.getState()
    if (cellAnnotations.some(c => c.shotClockBucket === currentBucket)) return

    // Clock counts down during play, so "preceding" bucket has a higher value
    const prevBucket = [...new Set(cellAnnotations.map(c => c.shotClockBucket))]
      .filter(b => b > currentBucket)
      .sort((a, b) => a - b)[0]  // smallest of those = closest preceding

    if (prevBucket === undefined) return
    cellAnnotations
      .filter(c => c.shotClockBucket === prevBucket)
      .forEach(ann => setCellAnnotation(ann.defenderId, ann.attackerId, currentBucket))
  }, [currentBucket]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCellDrop = (e: React.DragEvent, defenderId: number, bucket: number) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('attackerId')
    if (!raw) return
    const attackerId = raw === 'GUARD_NONE' ? 'GUARD_NONE' : parseInt(raw)
    useStore.getState().setCellAnnotation(defenderId, attackerId, bucket)
  }

  const handleCellDblClick = (defenderId: number, bucket: number) => {
    const existing = useStore.getState().cellAnnotations.find(
      c => c.defenderId === defenderId && c.shotClockBucket === bucket
    )
    if (existing) useStore.getState().removeCellAnnotation(existing.id)
  }

  const tableW = LABEL_W + buckets.length * CELL_W

  return (
    <div
      ref={scrollRef}
      style={{ overflowX: 'auto', overflowY: 'hidden', background: 'var(--bg-page)', userSelect: 'none' }}
    >
      <table style={{ width: tableW, minWidth: tableW, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {/* Label header */}
            <th style={{
              position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
              background: 'var(--bg-panel)', zIndex: 3,
              borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)',
              padding: '0 10px', height: HEADER_H, textAlign: 'left', verticalAlign: 'bottom',
            }}>
              {isQtr ? (
                <>
                  <div style={{ fontSize: 11, color: '#5a7aaa', fontWeight: 600 }}>Q-Clock</div>
                  <div style={{ fontSize: 9,  color: '#3a4a5a', marginTop: 1 }}>frame start</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: '#5a7aaa', fontWeight: 600 }}>Shot</div>
                  <div style={{ fontSize: 9,  color: '#3a4a5a', marginTop: 1 }}>Q-Clock</div>
                  <div style={{ fontSize: 9,  color: '#3a4a5a', marginTop: 1 }}>frame</div>
                </>
              )}
            </th>

            {/* Bucket headers */}
            {buckets.map(b => {
              const isActive = b === currentBucket
              const fStart   = bucketFrameStart.get(b)
              return (
                <th key={b} style={{
                  width: CELL_W, minWidth: CELL_W, height: HEADER_H,
                  background: isActive ? 'var(--bg-col-active)' : 'var(--bg-surface)',
                  borderBottom: `2px solid ${isActive ? '#4a7ae8' : 'var(--border)'}`,
                  borderRight: '1px solid var(--border-dim)',
                  textAlign: 'center', verticalAlign: 'middle',
                  padding: '3px 0', transition: 'background 0.15s',
                }}>
                  {isQtr ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#4a90d9' : 'var(--text-3)', lineHeight: 1.2 }}>
                        {fmtClock(b)}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#3a6aaa' : 'var(--text-4)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {fStart !== undefined ? `f${fStart}` : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700, color: isActive ? '#4a90d9' : 'var(--text-3)', lineHeight: 1.1 }}>
                        {b}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#4a7ac8' : 'var(--text-4)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {bucketQClock.get(b) !== undefined ? fmtClock(bucketQClock.get(b)!) : '--:--'}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#3a6aaa' : 'var(--text-4)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                        {fStart !== undefined ? `f${fStart}` : ''}
                      </div>
                    </>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {/* ── Dead time row ─────────────────────────────────────────── */}
          <tr>
            <td style={{
              position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
              height: DEAD_ROW_H, background: 'var(--bg-panel)', zIndex: 1,
              borderBottom: '2px solid var(--border)', borderRight: '1px solid var(--border)',
              padding: '0 10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>⏸</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#8a6a3a' }}>Dead time</span>
              </div>
            </td>
            {buckets.map(b => {
              const isDead   = deadTimeBuckets.includes(b)
              const isActive = b === currentBucket
              return (
                <td
                  key={b}
                  onClick={() => useStore.getState().toggleDeadTimeBucket(b)}
                  title={isDead ? 'Dead time — click to mark live' : 'Live — click to mark dead time'}
                  style={{
                    width: CELL_W, minWidth: CELL_W, height: DEAD_ROW_H,
                    textAlign: 'center', verticalAlign: 'middle',
                    background: isDead ? '#3a2000' : (isActive ? 'var(--bg-col-active)' : 'transparent'),
                    border: isActive ? '1px solid #2a4a7a' : `1px solid ${isDead ? '#7a4a00' : 'var(--border-dim)'}`,
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                >
                  {isDead && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#c87a20' }}>DEAD</span>
                  )}
                </td>
              )
            })}
          </tr>

          {/* ── Defender rows ──────────────────────────────────────────── */}
          {defPlayers.map(player => (
            <tr key={player.id}>
              <td style={{
                position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
                height: ROW_H, background: 'var(--bg-panel)', zIndex: 1,
                borderBottom: '1px solid var(--border-dim)', borderRight: '1px solid var(--border)',
                padding: '0 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: defColor, fontWeight: 700, fontSize: 14 }}>
                    #{player.jersey}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {player.name}
                  </span>
                </div>
              </td>

              {buckets.map(b => {
                const ann      = cellAnnotations.find(c => c.defenderId === player.id && c.shotClockBucket === b)
                const isActive = b === currentBucket
                const isDead   = deadTimeBuckets.includes(b)
                const isNone   = ann?.attackerId === 'GUARD_NONE'
                const attacker = ann && !isNone ? playerDict[ann.attackerId as number] : null

                return (
                  <td
                    key={b}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleCellDrop(e, player.id, b)}
                    onDoubleClick={() => handleCellDblClick(player.id, b)}
                    title={ann ? 'Double-click to clear' : 'Drag attacker here'}
                    style={{
                      width: CELL_W, minWidth: CELL_W, height: ROW_H,
                      textAlign: 'center', verticalAlign: 'middle',
                      background: isDead
                        ? '#2a1800'
                        : ann
                          ? (isActive ? 'var(--bg-cell-ann-act)' : (isNone ? 'var(--bg-cell-none)' : 'var(--bg-cell-ann)'))
                          : (isActive ? 'var(--bg-cell-active)' : 'var(--bg-page)'),
                      border: isActive ? '1px solid #2a4a7a' : `1px solid ${isDead ? '#5a3a00' : 'var(--border-dim)'}`,
                      cursor: 'default', transition: 'background 0.15s',
                      opacity: isDead ? 0.5 : 1,
                    }}
                  >
                    {ann && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: isNone ? '#666' : '#d4e8ff', display: 'inline-block', lineHeight: 1 }}>
                        {isNone ? '∅' : (attacker ? `#${attacker.jersey}` : '?')}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
