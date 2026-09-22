import { useMemo, useState } from 'react'
import type { CellStatus } from '../utils/agreement'
import type { DiffRun } from '../utils/diffRuns'
import type { AnnotationDocument } from '../utils/annotationDocument'
import type { AttackerId } from '../store/useStore'
import { fmtClock } from '../utils/timelineScale'

type SortKey = 'duration' | 'clock'
type Filter = CellStatus | 'all'

const STATUS_LABEL: Partial<Record<CellStatus, string>> = {
  disagree: 'Different attacker',
  'coverage-mismatch': 'Only one annotated',
  'defense-mismatch': 'Defending team',
}

/**
 * The disagreements as a work list.
 *
 * Most disagreements are one or two buckets long, which on a timeline is a
 * sliver too narrow to carry any text — so the timeline shows you the shape of
 * the problem but is a poor place to actually work through it. This is the
 * other half: ranked, filterable, and stating both answers in full.
 *
 * Sorted by duration by default, on the grounds that a three-second
 * disagreement is a clearer protocol failure than a half-second boundary
 * wobble, and worth reading first.
 */
export default function DisagreementQueue({
  runs, docA, docB, annotatorA, annotatorB, selected, onSelect,
}: {
  runs: DiffRun[]
  docA: AnnotationDocument
  docB: AnnotationDocument
  annotatorA: string
  annotatorB: string
  selected?: DiffRun | null
  onSelect?: (run: DiffRun) => void
}) {
  const [sort, setSort] = useState<SortKey>('duration')
  const [filter, setFilter] = useState<Filter>('all')
  const [defender, setDefender] = useState<number | 'all'>('all')

  const players = useMemo(() => ({ ...docB.players, ...docA.players }), [docA, docB])

  const nameOf = (id: AttackerId | undefined): string => {
    if (id === undefined) return '—'
    if (id === 'GUARD_NONE') return '∅ none'
    const p = players[id as number]
    return p ? `#${p.jersey}` : `#${id}`
  }

  const defenders = useMemo(
    () => [...new Set(runs.map(r => r.defenderId))]
      .sort((a, b) => (Number(players[a]?.jersey) || a) - (Number(players[b]?.jersey) || b)),
    [runs, players],
  )

  const rows = useMemo(() => {
    const kept = runs.filter(r =>
      (filter === 'all' || r.status === filter) &&
      (defender === 'all' || r.defenderId === defender))
    return [...kept].sort((x, y) =>
      sort === 'duration' ? y.durationS - x.durationS : y.startBucket - x.startBucket)
  }, [runs, filter, defender, sort])

  const counts = useMemo(() => {
    const c: Partial<Record<CellStatus, number>> = {}
    for (const r of runs) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [runs])

  const selectedIndex = selected
    ? rows.findIndex(r => r.defenderId === selected.defenderId && r.startBucket === selected.startBucket)
    : -1

  if (runs.length === 0) {
    return (
      <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
        Nothing to review — {annotatorA} and {annotatorB} agree on every comparable cell.
      </div>
    )
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg-surface)', color: 'var(--text-1)',
    border: '1px solid var(--border)', borderRadius: 4,
    padding: '2px 6px', fontSize: 11, cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0,
        padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 11,
      }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>
          {rows.length} to review
        </strong>
        {selectedIndex >= 0 && (
          <span style={{ color: 'var(--text-3)' }}>
            on {selectedIndex + 1} of {rows.length}
          </span>
        )}

        <label style={{ color: 'var(--text-3)' }}>
          Type{' '}
          <select value={filter} onChange={e => setFilter(e.target.value as Filter)} style={selectStyle}>
            <option value="all">all ({runs.length})</option>
            {(Object.keys(STATUS_LABEL) as CellStatus[])
              .filter(s => counts[s])
              .map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s]})</option>
              ))}
          </select>
        </label>

        <label style={{ color: 'var(--text-3)' }}>
          Defender{' '}
          <select
            value={String(defender)}
            onChange={e => setDefender(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={selectStyle}
          >
            <option value="all">all</option>
            {defenders.map(d => (
              <option key={d} value={d}>#{players[d]?.jersey ?? d} {players[d]?.name ?? ''}</option>
            ))}
          </select>
        </label>

        <label style={{ color: 'var(--text-3)' }}>
          Sort{' '}
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
            <option value="duration">longest first</option>
            <option value="clock">in game order</option>
          </select>
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
            No disagreements match this filter.
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <tbody>
              {rows.map(r => {
                const isSel = selected
                  && selected.defenderId === r.defenderId
                  && selected.startBucket === r.startBucket
                return (
                  <tr
                    key={`${r.defenderId}-${r.startBucket}-${r.status}`}
                    onClick={() => onSelect?.(r)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-dim)',
                      background: isSel ? 'var(--bg-col-active)' : undefined,
                    }}
                  >
                    <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)' }}>
                      {fmtClock(r.startBucket)}
                    </td>
                    <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: 'var(--text-1)' }}>
                        #{players[r.defenderId]?.jersey ?? r.defenderId}
                      </strong>
                    </td>
                    <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                      {annotatorA}: <strong>{nameOf(r.a)}</strong>
                    </td>
                    <td style={{ padding: '3px 8px', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                      {annotatorB}: <strong>{nameOf(r.b)}</strong>
                    </td>
                    <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)' }}>
                      {r.durationS.toFixed(1)}s
                    </td>
                    <td style={{ padding: '3px 8px', color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                      {r.status === 'disagree' ? '' : STATUS_LABEL[r.status] ?? r.status}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
