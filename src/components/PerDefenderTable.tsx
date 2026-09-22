import { useMemo, useState } from 'react'
import type { AgreementReport } from '../utils/agreement'
import type { AnnotationDocument } from '../utils/annotationDocument'

type SortKey = 'disagreements' | 'agreement' | 'jersey'

/**
 * Per-defender reliability.
 *
 * `agreement.ts` has computed all of this from the start — every defender's own
 * comparison count, agreement rate and κ — and none of it was ever rendered.
 * It answers the question the headline figures cannot: not "how well do these
 * two agree" but "on which players do they stop agreeing", which is what tells
 * you which part of the protocol is underspecified.
 *
 * Sorted by disagreement count by default, because the noisiest defender is the
 * one worth reading the protocol against.
 */
export default function PerDefenderTable({ report, docA, docB, onSelectDefender }: {
  report: AgreementReport
  docA: AnnotationDocument
  docB: AnnotationDocument
  onSelectDefender?: (defenderId: number) => void
}) {
  const [sort, setSort] = useState<SortKey>('disagreements')
  // Memoised so the row sort below is not invalidated on every render.
  const players = useMemo(() => ({ ...docB.players, ...docA.players }), [docA, docB])

  const rows = useMemo(() => {
    const withCounts = report.perDefender.map(d => ({
      ...d,
      nDisagree: d.nCompared - d.nAgree,
      jersey: Number(players[d.defenderId]?.jersey) || d.defenderId,
      name: players[d.defenderId]?.name ?? '',
    }))
    return withCounts.sort((x, y) => {
      if (sort === 'jersey') return x.jersey - y.jersey
      if (sort === 'agreement') return x.rawAgreement - y.rawAgreement
      return y.nDisagree - x.nDisagree
    })
  }, [report.perDefender, players, sort])

  if (rows.length === 0) return null

  const worst = Math.max(...rows.map(r => r.nDisagree), 1)

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      onClick={() => setSort(key)}
      aria-sort={sort === key ? 'descending' : 'none'}
      style={{
        textAlign: align, padding: '4px 8px', cursor: 'pointer',
        color: sort === key ? 'var(--text-1)' : 'var(--text-3)',
        fontWeight: sort === key ? 700 : 400, whiteSpace: 'nowrap',
      }}
    >
      {label}{sort === key ? ' ▾' : ''}
    </th>
  )

  return (
    <div style={{
      flexShrink: 0, background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)', padding: '8px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <strong style={{ fontSize: 12, color: 'var(--text-1)' }}>By defender</strong>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
          where the two stop agreeing — click a row to filter, a heading to sort
        </span>
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {th('jersey', 'Defender', 'left')}
              <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-3)' }}>
                Compared
              </th>
              {th('agreement', 'Agreement')}
              <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--text-3)' }}>
                κ
              </th>
              {th('disagreements', 'Disagreements')}
              <th style={{ width: '25%' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.defenderId}
                onClick={() => onSelectDefender?.(r.defenderId)}
                style={{
                  borderBottom: '1px solid var(--border-dim)',
                  cursor: onSelectDefender ? 'pointer' : 'default',
                }}
              >
                <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>
                  <strong style={{ color: 'var(--text-1)' }}>#{players[r.defenderId]?.jersey ?? r.defenderId}</strong>
                  <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{r.name}</span>
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.nCompared}
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {(r.rawAgreement * 100).toFixed(1)}%
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.kappa === null ? '—' : r.kappa.toFixed(2)}
                </td>
                <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.nDisagree}
                </td>
                <td style={{ padding: '3px 8px' }}>
                  <div
                    aria-hidden="true"
                    style={{
                      height: 8, borderRadius: 2,
                      width: `${(r.nDisagree / worst) * 100}%`,
                      minWidth: r.nDisagree > 0 ? 2 : 0,
                      background: 'var(--accent-danger)',
                      opacity: 0.75,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>
        κ is undefined (—) for a defender both annotators only ever gave one answer for.
      </div>
    </div>
  )
}
