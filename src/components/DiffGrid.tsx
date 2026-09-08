import { useMemo } from 'react'
import type { AgreementReport, CellStatus } from '../utils/agreement'
import type { AnnotationDocument } from '../utils/annotationDocument'
import type { AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { buildDiffRuns, isReviewable, type DiffRun } from '../utils/diffRuns'

const LABEL_W = 170
const ROW_H = 30
const PX_PER_S = 26

const STATUS_STYLE: Record<CellStatus, { bg: string; fg: string; label: string }> = {
  agree:               { bg: 'var(--agree-bg, #1f3d2b)',    fg: 'var(--text-3)', label: 'Agree' },
  disagree:            { bg: 'var(--accent-danger, #c0504d)', fg: '#fff',        label: 'Different attacker' },
  'coverage-mismatch': { bg: 'var(--confidence-mid, #b8860b)', fg: '#fff',       label: 'Only one annotated' },
  'dead-excluded':     { bg: 'var(--bg-surface)',           fg: 'var(--text-4)', label: 'Dead ball (excluded)' },
  'defense-mismatch':  { bg: '#7b3fa0',                     fg: '#fff',          label: 'Defending team differs' },
}

interface Props {
  report: AgreementReport
  docA: AnnotationDocument
  docB: AnnotationDocument
  selectedRun?: DiffRun | null
  onSelectRun?: (run: DiffRun) => void
}

export default function DiffGrid({ report, docA, docB, selectedRun, onSelectRun }: Props) {
  const orderedBuckets = useMemo(
    () => [...new Set([...docA.buckets.keys(), ...docB.buckets.keys()])].sort((x, y) => y - x),
    [docA, docB],
  )
  const runs = useMemo(
    () => buildDiffRuns(report.cells, orderedBuckets),
    [report.cells, orderedBuckets],
  )

  const players = { ...docB.players, ...docA.players }
  const nameOf = (id: AttackerId | undefined): string => {
    if (id === undefined) return '—'
    if (id === 'GUARD_NONE') return '∅'
    const p = players[id as number]
    return p ? `#${p.jersey}` : `#${id}`
  }

  const defenderIds = [...new Set(runs.map(r => r.defenderId))].sort((a, b) => {
    const pa = players[a], pb = players[b]
    return (Number(pa?.jersey) || a) - (Number(pb?.jersey) || b)
  })

  if (runs.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-4)', fontSize: 13 }}>No overlapping data to compare</div>
  }

  const firstBucket = orderedBuckets[0] ?? 0
  const xOf = (bucket: number) => (firstBucket - bucket) * PX_PER_S
  const totalW = Math.max(240, orderedBuckets.length * QUARTER_BUCKET_S * PX_PER_S)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
      <div style={{
        display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0,
        padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 11,
      }}>
        {(Object.keys(STATUS_STYLE) as CellStatus[]).map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 11, height: 11, borderRadius: 2, flexShrink: 0,
              background: STATUS_STYLE[s].bg, border: '1px solid var(--border)',
            }} />
            <span style={{ color: 'var(--text-3)' }}>{STATUS_STYLE[s].label}</span>
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-4)' }}>
          n / p to step between disagreements · click a bar to jump there
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: LABEL_W + totalW }}>
          {defenderIds.map(defId => {
            const p = players[defId]
            return (
              <div key={defId} style={{ display: 'flex', height: ROW_H, alignItems: 'center' }}>
                <div style={{
                  width: LABEL_W, flexShrink: 0, padding: '0 10px', height: '100%',
                  position: 'sticky', left: 0, background: 'var(--bg-panel)', zIndex: 3,
                  borderRight: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 13 }}>
                    #{p?.jersey ?? defId}
                  </span>
                  <span style={{
                    color: 'var(--text-3)', fontSize: 11,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p?.name ?? ''}</span>
                </div>

                <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                  {runs.filter(r => r.defenderId === defId).map(r => {
                    const st = STATUS_STYLE[r.status]
                    const width = Math.max(4, r.durationS * PX_PER_S - 1)
                    const selected = selectedRun
                      && selectedRun.defenderId === r.defenderId
                      && selectedRun.startBucket === r.startBucket
                    const detail = r.status === 'agree'
                      ? `${nameOf(r.a)}`
                      : `A:${nameOf(r.a)} → B:${nameOf(r.b)}`
                    const title =
                      `${st.label} · ${r.durationS.toFixed(1)}s` +
                      (r.status === 'agree' ? ` · both marked ${nameOf(r.a)}` : ` · ${report.annotatorA || 'A'}:${nameOf(r.a)} / ${report.annotatorB || 'B'}:${nameOf(r.b)}`)

                    return (
                      <button
                        key={`${r.startBucket}-${r.status}`}
                        onClick={() => onSelectRun?.(r)}
                        title={title}
                        aria-label={title}
                        style={{
                          position: 'absolute', left: xOf(r.startBucket), width,
                          top: 4, height: ROW_H - 8,
                          background: st.bg, color: st.fg,
                          border: selected ? '2px solid var(--accent, #4a90d9)' : '1px solid var(--border)',
                          borderRadius: 3, cursor: 'pointer', overflow: 'hidden',
                          fontSize: 10, whiteSpace: 'nowrap', padding: '0 3px',
                          display: 'flex', alignItems: 'center',
                        }}
                      >
                        {width > 46 && isReviewable(r.status) ? detail : ''}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
