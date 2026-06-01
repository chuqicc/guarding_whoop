import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { COLOR_TEAM_A } from '../constants'

const CELL_W    = 58   // px per shot-clock second
const LABEL_W   = 160  // px for the sticky defender label column
const HEADER_H  = 52   // px for header row (two lines: shot clock + quarter clock)
const ROW_H     = 44   // px per defender row

function fmtClock(s: number): string {
  if (!isFinite(s)) return '--:--'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function AnnotationArea() {
  const possession      = useStore(s => s.possession)
  const frames          = useStore(s => s.frames)
  const currentFrame    = useStore(s => s.currentFrame)
  const cellAnnotations = useStore(s => s.cellAnnotations)
  const playerDict      = useStore(s => s.playerDict)
  const scrollRef       = useRef<HTMLDivElement>(null)

  if (!possession) {
    return (
      <div style={{ padding: 16, color: '#555', fontSize: 13 }}>
        Load possession data to annotate
      </div>
    )
  }

  const defTeam = possession.defendingTeamId === possession.teamA.teamId
    ? possession.teamA
    : possession.teamB

  // Collect unique shot-clock buckets from frames, sorted descending (24 → 0)
  const buckets: number[] = [...new Set(
    frames
      .filter(f => f.shotClock !== null && !isNaN(f.shotClock!))
      .map(f => Math.floor(f.shotClock!))
  )].sort((a, b) => b - a)

  // For each bucket, compute the representative quarter clock (highest = possession start of that second)
  const bucketQClock = new Map<number, number>()
  for (const f of frames) {
    if (f.shotClock !== null && !isNaN(f.shotClock!)) {
      const b = Math.floor(f.shotClock!)
      const cur = bucketQClock.get(b)
      if (cur === undefined || f.quarterClock > cur) bucketQClock.set(b, f.quarterClock)
    }
  }

  const currentBucket =
    frames[currentFrame]?.shotClock !== null &&
    frames[currentFrame]?.shotClock !== undefined &&
    !isNaN(frames[currentFrame]!.shotClock!)
      ? Math.floor(frames[currentFrame]!.shotClock!)
      : null

  // Auto-scroll so current bucket is visible
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
      style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        background: 'var(--bg-page)',
        userSelect: 'none',
      }}
    >
      <table
        style={{
          width: tableW,
          minWidth: tableW,
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <thead>
          <tr>
            {/* Sticky label header */}
            <th
              style={{
                position: 'sticky',
                left: 0,
                width: LABEL_W,
                minWidth: LABEL_W,
                background: 'var(--bg-panel)',
                zIndex: 3,
                borderBottom: '2px solid var(--border)',
                borderRight: '1px solid var(--border)',
                padding: '0 10px',
                height: HEADER_H,
                textAlign: 'left',
                verticalAlign: 'bottom',
              }}
            >
              <div style={{ fontSize: 11, color: '#5a7aaa', fontWeight: 600, letterSpacing: 0.5 }}>Shot</div>
              <div style={{ fontSize: 10, color: '#3a4a5a', marginTop: 2 }}>Q-Clock</div>
            </th>
            {/* Bucket headers — shot clock + quarter clock */}
            {buckets.map(b => {
              const qc = bucketQClock.get(b)
              const isActive = b === currentBucket
              return (
                <th
                  key={b}
                  style={{
                    width: CELL_W,
                    minWidth: CELL_W,
                    height: HEADER_H,
                    background: isActive ? 'var(--bg-col-active)' : 'var(--bg-surface)',
                    borderBottom: `2px solid ${isActive ? '#4a7ae8' : 'var(--border)'}`,
                    borderRight: '1px solid var(--border-dim)',
                    textAlign: 'center',
                    verticalAlign: 'middle',
                    padding: '4px 0',
                    transition: 'background 0.15s',
                  }}
                >
                  {/* Shot clock second */}
                  <div style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: isActive ? '#4a90d9' : 'var(--text-3)',
                    lineHeight: 1.1,
                  }}>
                    {b}
                  </div>
                  {/* Quarter clock */}
                  <div style={{
                    fontSize: 10,
                    color: isActive ? '#4a7ac8' : 'var(--text-4)',
                    marginTop: 3,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {qc !== undefined ? fmtClock(qc) : '--:--'}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {defTeam.players.map(player => (
            <tr key={player.id}>
              {/* Sticky defender label */}
              <td
                style={{
                  position: 'sticky',
                  left: 0,
                  width: LABEL_W,
                  minWidth: LABEL_W,
                  height: ROW_H,
                  background: 'var(--bg-panel)',
                  zIndex: 1,
                  borderBottom: '1px solid var(--border-dim)',
                  borderRight: '1px solid var(--border)',
                  padding: '0 10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: COLOR_TEAM_A, fontWeight: 700, fontSize: 14 }}>
                    #{player.jersey}
                  </span>
                  <span style={{
                    color: 'var(--text-2)', fontSize: 12,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {player.name}
                  </span>
                </div>
              </td>

              {/* Annotation cells */}
              {buckets.map(b => {
                const ann = cellAnnotations.find(
                  c => c.defenderId === player.id && c.shotClockBucket === b
                )
                const isActive = b === currentBucket
                const isNone = ann?.attackerId === 'GUARD_NONE'
                const attacker = ann && !isNone
                  ? playerDict[ann.attackerId as number]
                  : null

                return (
                  <td
                    key={b}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleCellDrop(e, player.id, b)}
                    onDoubleClick={() => handleCellDblClick(player.id, b)}
                    title={ann ? 'Double-click to clear' : 'Drag attacker here'}
                    style={{
                      width: CELL_W,
                      minWidth: CELL_W,
                      height: ROW_H,
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      background: ann
                        ? (isActive ? 'var(--bg-cell-ann-act)' : (isNone ? 'var(--bg-cell-none)' : 'var(--bg-cell-ann)'))
                        : (isActive ? 'var(--bg-cell-active)' : 'var(--bg-page)'),
                      border: isActive ? '1px solid #2a4a7a' : '1px solid var(--border-dim)',
                      cursor: 'default',
                      transition: 'background 0.15s',
                    }}
                  >
                    {ann && (
                      <span style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: isNone ? '#666' : '#d4e8ff',
                        display: 'inline-block',
                        lineHeight: 1,
                      }}>
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
