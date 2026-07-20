import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { COLOR_TEAM_A, COLOR_TEAM_B, QUARTER_BUCKET_S } from '../constants'
import { getBucketDefendingTeamId } from '../utils/defenseTeam'
import { computeCarryForward } from '../utils/carryForward'

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
  const shotBuckets        = useStore(s => s.shotBuckets)
  const reboundBuckets     = useStore(s => s.reboundBuckets)
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

  // Current defending team's rows (primary), plus the other team's rows for
  // any historical defensive assignments recorded before the last swap.
  const curDefTeam  = meta.defendingTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
  const otherTeam   = meta.defendingTeamId === meta.teamA.teamId ? meta.teamB : meta.teamA
  const curDefColor = curDefTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B
  const otherColor  = otherTeam.teamId  === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B

  const onCourtIds = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const historicalDefenderIds = new Set(cellAnnotations.map(c => c.defenderId))

  const buildRows = (team: typeof meta.teamA) =>
    team.players.filter(p => onCourtIds.has(p.id) || historicalDefenderIds.has(p.id))

  const curDefRows = buildRows(curDefTeam)
  const otherRows  = buildRows(otherTeam)

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

  // Per-bucket: representative quarter clock + shot clock + first frame index
  const bucketQClock     = new Map<number, number>()
  const bucketShotClock  = new Map<number, number>()
  const bucketFrameStart = new Map<number, number>()
  for (const f of frames) {
    const b = getBucket(f.quarterClock, f.shotClock)
    if (b === null) continue
    if (!bucketFrameStart.has(b) || f.frameIndex < bucketFrameStart.get(b)!) {
      bucketFrameStart.set(b, f.frameIndex)
    }
    const cur = bucketQClock.get(b)
    if (cur === undefined || f.quarterClock > cur) {
      bucketQClock.set(b, f.quarterClock)
      if (f.shotClock !== null && !isNaN(f.shotClock)) bucketShotClock.set(b, f.shotClock)
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

  // Drag across the bucket header row to scrub through frames
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [isScrubbing, setIsScrubbing] = useState(false)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!isScrubbing) return
    const onUp = () => setIsScrubbing(false)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [isScrubbing])

  const scrubToBucket = (b: number) => {
    const fStart = bucketFrameStart.get(b)
    if (fStart === undefined) return
    const { setPlaying, setCurrentFrame } = useStore.getState()
    setPlaying(false)
    setCurrentFrame(fStart)
  }

  // Carry annotations forward: for each defender with no annotation in the current
  // (empty) bucket, copy from that defender's own nearest preceding bucket.
  // Rules (dead-time, swap barriers, memory toggle) live in computeCarryForward.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (currentBucket === null) return
    const s = useStore.getState()
    const fills = computeCarryForward({
      currentBucket,
      cellAnnotations:     s.cellAnnotations,
      playerDict:          s.playerDict,
      defendingTeamId:     meta.defendingTeamId,
      autoFillMemory:      s.autoFillMemory,
      deadTimeBuckets:     s.deadTimeBuckets,
      memoryBarrierFrames: s.memoryBarrierFrames,
      bucketFrameStart,
    })
    for (const f of fills) {
      s.setCellAnnotation(f.defenderId, f.attackerId, currentBucket, f.confidence)
    }
  }, [currentBucket]) // eslint-disable-line react-hooks/exhaustive-deps

  // Confidence rating: click an annotated cell to focus it, then press 1/2/3
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [focusedCell, setFocusedCell] = useState<{ defenderId: number; bucket: number } | null>(null)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFocusedCell(null); return }
      if (!focusedCell) return
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        useStore.getState().setCellConfidence(focusedCell.defenderId, focusedCell.bucket, Number(e.key) as 1 | 2 | 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedCell])

  const handleCellDrop = (e: React.DragEvent, defenderId: number, bucket: number) => {
    e.preventDefault()
    // Dead-time buckets never accept assignments (hard rule, feature #1)
    if (useStore.getState().deadTimeBuckets.includes(bucket)) return
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

  const renderDefenderRow = (player: typeof meta.teamA.players[number], color: string) => (
    <tr key={player.id}>
      <td style={{
        position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
        height: ROW_H, background: 'var(--bg-panel)', zIndex: 1,
        borderBottom: '1px solid var(--border-dim)', borderRight: '1px solid var(--border)',
        padding: '0 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color, fontWeight: 700, fontSize: 14 }}>
            #{player.jersey}
          </span>
          <span style={{ color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.name}
          </span>
        </div>
      </td>

      {buckets.map(b => {
        const isDead     = deadTimeBuckets.includes(b)
        const bDefTeamId = getBucketDefendingTeamId(b, cellAnnotations, playerDict, meta.defendingTeamId)
        const isActiveDefender = player.teamId === bDefTeamId

        if (!isActiveDefender) {
          return (
            <td
              key={b}
              title="Other team was on offense this bucket"
              style={{
                width: CELL_W, minWidth: CELL_W, height: ROW_H,
                background: 'var(--bg-cell)',
                border: `1px solid ${isDead ? 'var(--border-dead)' : 'var(--border-dim)'}`,
                opacity: 0.25,
                cursor: 'not-allowed',
              }}
            />
          )
        }

        const ann       = cellAnnotations.find(c => c.defenderId === player.id && c.shotClockBucket === b)
        const isActive  = b === currentBucket
        const isNone    = ann?.attackerId === 'GUARD_NONE'
        const attacker  = ann && !isNone ? playerDict[ann.attackerId as number] : null
        const confidence = ann?.confidence ?? 3
        const isFocused = !!ann && focusedCell?.defenderId === player.id && focusedCell?.bucket === b
        const confColor = confidence === 1 ? 'var(--confidence-low)' : confidence === 2 ? 'var(--confidence-mid)' : 'transparent'

        return (
          <td
            key={b}
            onClick={() => {
              if (!ann) return
              setFocusedCell(prev => (prev?.defenderId === player.id && prev?.bucket === b) ? null : { defenderId: player.id, bucket: b })
            }}
            onDragOver={e => { if (!isDead) e.preventDefault() }}
            onDrop={e => handleCellDrop(e, player.id, b)}
            onDoubleClick={() => handleCellDblClick(player.id, b)}
            title={isDead
              ? 'Dead time — assignments locked'
              : ann ? 'Click to focus, press 1/2/3 for confidence · Double-click to clear' : 'Drag attacker here'}
            style={{
              width: CELL_W, minWidth: CELL_W, height: ROW_H,
              textAlign: 'center', verticalAlign: 'middle',
              background: isDead
                ? 'var(--bg-dead-dim)'
                : ann
                  ? (isActive ? 'var(--bg-cell-ann-act)' : (isNone ? 'var(--bg-cell-none)' : 'var(--bg-cell-ann)'))
                  : (isActive ? 'var(--bg-cell-active)' : 'var(--bg-page)'),
              border: isActive ? '1px solid #2a4a7a' : `1px solid ${isDead ? 'var(--border-dead)' : 'var(--border-dim)'}`,
              borderBottom: `3px solid ${confColor}`,
              boxShadow: isFocused ? 'inset 0 0 0 2px var(--focus-ring)' : 'none',
              cursor: isDead ? 'not-allowed' : ann ? 'pointer' : 'default', transition: 'background 0.15s',
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
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-page)' }}>
      {/* Table — scrolls both directions */}
      <div
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', userSelect: 'none' }}
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
                  <div style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>Q-Clock</div>
                  <div style={{ fontSize: 9,  color: 'var(--text-3)', marginTop: 1 }}>Shot</div>
                  <div style={{ fontSize: 9,  color: 'var(--text-3)', marginTop: 1 }}>frame start</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600 }}>Shot</div>
                  <div style={{ fontSize: 9,  color: 'var(--text-3)', marginTop: 1 }}>Q-Clock</div>
                  <div style={{ fontSize: 9,  color: 'var(--text-3)', marginTop: 1 }}>frame</div>
                </>
              )}
            </th>

            {/* Bucket headers */}
            {buckets.map(b => {
              const isActive = b === currentBucket
              const fStart   = bucketFrameStart.get(b)
              return (
                <th
                  key={b}
                  onMouseDown={() => { setIsScrubbing(true); scrubToBucket(b) }}
                  onMouseEnter={() => { if (isScrubbing) scrubToBucket(b) }}
                  title="Drag to scrub through frames"
                  style={{
                    width: CELL_W, minWidth: CELL_W, height: HEADER_H,
                    background: isActive ? 'var(--bg-col-active)' : 'var(--bg-surface)',
                    borderBottom: `2px solid ${isActive ? '#4a7ae8' : 'var(--border)'}`,
                    borderRight: '1px solid var(--border-dim)',
                    textAlign: 'center', verticalAlign: 'middle',
                    padding: '3px 0', transition: 'background 0.15s',
                    position: 'relative', cursor: 'grab', userSelect: 'none',
                  }}>
                  <button
                    onClick={() => useStore.getState().clearBucketAnnotations(b)}
                    title="Clear all assignments in this column"
                    style={{
                      position: 'absolute', top: 1, right: 1,
                      width: 14, height: 14, lineHeight: '12px',
                      padding: 0, fontSize: 10, fontWeight: 700,
                      background: 'transparent', color: 'var(--text-4)',
                      border: '1px solid var(--border-dim)', borderRadius: 3,
                      cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                  {isQtr ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#4a90d9' : 'var(--text-3)', lineHeight: 1.2 }}>
                        {fmtClock(b)}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#4a7ac8' : 'var(--text-4)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {bucketShotClock.get(b) !== undefined ? bucketShotClock.get(b)!.toFixed(1) : ''}
                      </div>
                      <div style={{ fontSize: 9, color: isActive ? '#3a6aaa' : 'var(--text-4)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
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
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dead)' }}>Dead time</span>
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
                    background: isDead ? 'var(--bg-dead)' : (isActive ? 'var(--bg-col-active)' : 'transparent'),
                    border: isActive ? '1px solid #2a4a7a' : `1px solid ${isDead ? 'var(--border-dead-active)' : 'var(--border-dim)'}`,
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                >
                  {isDead && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dead-active)' }}>DEAD</span>
                  )}
                </td>
              )
            })}
          </tr>

          {/* ── Shot / Rebound event rows ─────────────────────────────── */}
          {([
            { label: 'Shot',    icon: '🏀', marked: shotBuckets,    color: '#e0952c', tag: 'SHOT',
              toggle: (b: number) => useStore.getState().toggleShotBucket(b) },
            { label: 'Rebound', icon: '↩',  marked: reboundBuckets, color: '#4caf7d', tag: 'REB',
              toggle: (b: number) => useStore.getState().toggleReboundBucket(b) },
          ] as const).map(row => (
            <tr key={row.label}>
              <td style={{
                position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
                height: DEAD_ROW_H, background: 'var(--bg-panel)', zIndex: 1,
                borderBottom: row.label === 'Rebound' ? '2px solid var(--border)' : '1px solid var(--border-dim)',
                borderRight: '1px solid var(--border)',
                padding: '0 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12 }}>{row.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: row.color }}>{row.label}</span>
                </div>
              </td>
              {buckets.map(b => {
                const isMarked = row.marked.includes(b)
                const isActive = b === currentBucket
                return (
                  <td
                    key={b}
                    onClick={() => row.toggle(b)}
                    title={isMarked ? `${row.label} — click to unmark` : `Click to mark ${row.label.toLowerCase()} in this bucket`}
                    style={{
                      width: CELL_W, minWidth: CELL_W, height: DEAD_ROW_H,
                      textAlign: 'center', verticalAlign: 'middle',
                      background: isMarked ? `${row.color}33` : (isActive ? 'var(--bg-col-active)' : 'transparent'),
                      border: isActive ? '1px solid #2a4a7a' : `1px solid ${isMarked ? row.color : 'var(--border-dim)'}`,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                  >
                    {isMarked && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: row.color }}>{row.tag}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}

          {/* ── Current defending team's rows ───────────────────────────── */}
          {curDefRows.map(player => renderDefenderRow(player, curDefColor))}

          {/* ── Other team's historical defensive assignments ───────────── */}
          {otherRows.length > 0 && (
            <>
              <tr>
                <td style={{
                  position: 'sticky', left: 0, width: LABEL_W, minWidth: LABEL_W,
                  height: 20, background: 'var(--bg-panel)', zIndex: 1,
                  borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)',
                  borderTop: '2px solid var(--border)',
                  padding: '0 10px',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: otherColor, textTransform: 'uppercase' }}>
                    {otherTeam.abbr} (prev. defense)
                  </span>
                </td>
                {buckets.map(b => (
                  <td key={b} style={{
                    width: CELL_W, minWidth: CELL_W, height: 20,
                    borderTop: '2px solid var(--border)',
                    borderRight: '1px solid var(--border-dim)',
                    background: 'var(--bg-panel)',
                  }} />
                ))}
              </tr>
              {otherRows.map(player => renderDefenderRow(player, otherColor))}
            </>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
