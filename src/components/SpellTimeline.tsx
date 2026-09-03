import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { computeMarkingSpells, summariseSpells, type MarkingSpell, type SpellBreak } from '../utils/spells'
import { QUARTER_BUCKET_S, COLOR_TEAM_A, COLOR_TEAM_B } from '../constants'

const LABEL_W = 150
const ROW_H   = 30
const PX_PER_S = 26

/** Why a spell ended, shown as the marker on its trailing edge. */
const BREAK_MARK: Record<SpellBreak, { mark: string; hint: string }> = {
  switch:      { mark: '⇄', hint: 'switched to another attacker' },
  gap:         { mark: '·', hint: 'next bucket was left unannotated' },
  'dead-ball': { mark: '■', hint: 'dead ball' },
  swap:        { mark: '⇆', hint: 'defending team swapped' },
  end:         { mark: '',  hint: 'ran to the end of the data' },
}

export default function SpellTimeline() {
  const quarterMeta     = useStore(s => s.quarterMeta)
  const frames          = useStore(s => s.frames)
  const cellAnnotations = useStore(s => s.cellAnnotations)
  const deadTimeBuckets = useStore(s => s.deadTimeBuckets)
  const memoryBarrierFrames = useStore(s => s.memoryBarrierFrames)
  const playerDict      = useStore(s => s.playerDict)
  const currentFrame    = useStore(s => s.currentFrame)

  // Bucket list + frame index, derived once per data change rather than per render.
  const { allBuckets, bucketFrameStart } = useMemo(() => {
    const seen = new Map<number, number>()
    for (const f of frames) {
      const b = Math.floor(f.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
      if (!seen.has(b) || f.frameIndex < seen.get(b)!) seen.set(b, f.frameIndex)
    }
    return {
      allBuckets: [...seen.keys()].sort((a, b) => b - a),
      bucketFrameStart: seen,
    }
  }, [frames])

  const spells = useMemo(
    () => computeMarkingSpells({
      cellAnnotations, allBuckets, deadTimeBuckets, memoryBarrierFrames, bucketFrameStart,
    }),
    [cellAnnotations, allBuckets, deadTimeBuckets, memoryBarrierFrames, bucketFrameStart],
  )

  const summary = useMemo(() => summariseSpells(spells), [spells])

  if (!quarterMeta) {
    return <Empty>Load tracking data to see marking spells</Empty>
  }
  if (spells.length === 0) {
    return <Empty>No spells yet — assign a defender to an attacker and they will appear here</Empty>
  }

  // One row per defender, ordered by team then jersey.
  const defenderIds = [...new Set(spells.map(s => s.defenderId))].sort((a, b) => {
    const pa = playerDict[a], pb = playerDict[b]
    if (!pa || !pb) return a - b
    if (pa.teamId !== pb.teamId) return pa.teamId - pb.teamId
    return Number(pa.jersey) - Number(pb.jersey)
  })

  const firstBucket = allBuckets[0] ?? 0
  // Clock counts down, so elapsed time is (start - bucket).
  const xOf = (bucket: number) => (firstBucket - bucket) * PX_PER_S
  const totalW = Math.max(200, (allBuckets.length * QUARTER_BUCKET_S) * PX_PER_S)

  const currentBucket = frames[currentFrame]
    ? Math.floor(frames[currentFrame].quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
    : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
      {/* Summary bar */}
      <div style={{
        display: 'flex', gap: 18, alignItems: 'center', flexShrink: 0,
        padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 12,
      }}>
        <Stat label="spells"        value={String(summary.count)} />
        <Stat label="total marked"  value={`${summary.totalSeconds.toFixed(1)}s`} />
        <Stat label="median length" value={`${summary.medianSeconds.toFixed(1)}s`} />
        <Stat label="switches"      value={String(summary.switches)} />
        <span style={{ marginLeft: 'auto', color: 'var(--text-4)', fontSize: 11 }}>
          ⇄ switch · ■ dead ball · ⇆ defence swap · · gap
        </span>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: LABEL_W + totalW }}>
          {currentBucket !== null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: LABEL_W + xOf(currentBucket), width: 2,
              background: 'var(--accent, #4a90d9)', opacity: 0.9, zIndex: 2, pointerEvents: 'none',
            }} />
          )}

          {defenderIds.map(defId => {
            const p = playerDict[defId]
            const color = p && quarterMeta.teamA.teamId === p.teamId ? COLOR_TEAM_A : COLOR_TEAM_B
            const mine = spells.filter(s => s.defenderId === defId)
            return (
              <div key={defId} style={{ display: 'flex', height: ROW_H, alignItems: 'center' }}>
                <div style={{
                  width: LABEL_W, flexShrink: 0, padding: '0 10px',
                  position: 'sticky', left: 0, background: 'var(--bg-panel)', zIndex: 3,
                  borderRight: '1px solid var(--border)', height: '100%',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ color, fontWeight: 700, fontSize: 13 }}>#{p?.jersey ?? defId}</span>
                  <span style={{
                    color: 'var(--text-3)', fontSize: 11,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p?.name ?? ''}</span>
                </div>

                <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                  {mine.map(s => <SpellBar key={`${s.defenderId}-${s.startBucket}`} spell={s} xOf={xOf} />)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SpellBar({ spell, xOf }: { spell: MarkingSpell; xOf: (b: number) => number }) {
  const playerDict = useStore(s => s.playerDict)
  const setCurrentFrame = useStore(s => s.setCurrentFrame)

  const none = spell.attackerId === 'GUARD_NONE'
  const att  = none ? null : playerDict[spell.attackerId as number]
  const left = xOf(spell.startBucket)
  const width = Math.max(6, spell.durationS * PX_PER_S - 2)
  const brk = BREAK_MARK[spell.endedBy]

  const label = none ? '∅' : `#${att?.jersey ?? spell.attackerId}`
  const title =
    `${spell.durationS.toFixed(1)}s marking ${none ? 'no one' : (att?.name ?? spell.attackerId)}` +
    ` · confidence ${spell.minConfidence}` +
    (brk.hint ? ` · ended: ${brk.hint}` : '') +
    (spell.startFrame !== undefined ? ` · click to jump to frame ${spell.startFrame}` : '')

  return (
    <button
      onClick={() => { if (spell.startFrame !== undefined) setCurrentFrame(spell.startFrame) }}
      title={title}
      aria-label={title}
      style={{
        position: 'absolute', left, width, top: 4, height: ROW_H - 8,
        background: none ? 'var(--bg-surface)' : 'var(--bg-inter)',
        border: `1px solid ${none ? 'var(--border-dim)' : 'var(--border)'}`,
        // Confidence is a property of the data, so show it rather than hide it.
        borderLeftWidth: 3,
        borderLeftColor: spell.minConfidence === 1 ? 'var(--confidence-low)'
                       : spell.minConfidence === 2 ? 'var(--confidence-mid)'
                       : (none ? 'var(--border-dim)' : 'var(--accent, #4a90d9)'),
        borderRadius: 3, cursor: 'pointer', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 4px', fontSize: 11, whiteSpace: 'nowrap',
        color: none ? 'var(--text-4)' : 'var(--text-1)',
      }}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      {width > 54 && (
        <span style={{ color: 'var(--text-4)', fontSize: 10 }}>
          {spell.durationS.toFixed(1)}s{brk.mark}
        </span>
      )}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span aria-label={`${value} ${label}`} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
      <strong style={{ color: 'var(--text-1)', fontSize: 13 }}>{value}</strong>
      <span style={{ color: 'var(--text-4)', fontSize: 11 }}>{label}</span>
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, color: 'var(--text-4)', fontSize: 13 }}>{children}</div>
  )
}
