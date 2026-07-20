import { useStore } from '../store/useStore'
import { COLOR_TEAM_A, COLOR_TEAM_B } from '../constants'

export default function RosterPanel() {
  const possession          = useStore(s => s.possession)
  const quarterMeta         = useStore(s => s.quarterMeta)
  const toggleDefendingTeam = useStore(s => s.toggleDefendingTeam)
  const frames              = useStore(s => s.frames)
  const currentFrame        = useStore(s => s.currentFrame)

  const meta = possession ?? quarterMeta

  if (!meta) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', padding: 12, color: 'var(--text-3)', fontSize: 13 }}>
        No data loaded
      </div>
    )
  }

  const defTeam  = meta.defendingTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
  const attTeam  = meta.defendingTeamId === meta.teamA.teamId ? meta.teamB : meta.teamA
  const defColor = defTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B
  const attColor = attTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B

  const onCourtIds = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const defPlayers = defTeam.players.filter(p => onCourtIds.has(p.id))
  const attPlayers = attTeam.players.filter(p => onCourtIds.has(p.id))

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Roster</span>
        <button
          onClick={toggleDefendingTeam}
          style={{ background: 'var(--mode-off-bg)', color: 'var(--text-1)', border: 'none', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
        >
          ⇄ Swap teams
        </button>
      </div>

      {/* Two columns */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Defense */}
        <div style={{ flex: 1, background: 'var(--bg-def)', padding: 8, overflowY: 'auto', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: defColor, textTransform: 'uppercase', marginBottom: 6 }}>
            {defTeam.abbr} — Defense
          </div>
          {defPlayers.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-inter)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', marginBottom: 4 }}>
              <span style={{ color: defColor, fontWeight: 700, fontSize: 14, minWidth: 26, flexShrink: 0 }}>#{p.jersey}</span>
              <span title={p.name} style={{ color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {p.name}
              </span>
            </div>
          ))}
        </div>

        {/* Offense — draggable for drop-to-cell */}
        <div style={{ flex: 1, background: 'var(--bg-att)', padding: 8, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: attColor, textTransform: 'uppercase', marginBottom: 6 }}>
            {attTeam.abbr} — Offense
          </div>
          {attPlayers.map(p => (
            <div
              key={p.id}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('attackerId', String(p.id))
                useStore.getState().setPlaying(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-inter)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', marginBottom: 4, cursor: 'grab', userSelect: 'none' }}
            >
              <span style={{ color: attColor, fontWeight: 700, fontSize: 14, minWidth: 26, flexShrink: 0 }}>#{p.jersey}</span>
              <span title={p.name} style={{ color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {p.name}
              </span>
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />

          {/* GUARD_NONE token */}
          <div
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('attackerId', 'GUARD_NONE')
              useStore.getState().setPlaying(false)
            }}
            title="Drag to a cell: defender has no specific assignment"
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-inter)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic', cursor: 'grab', userSelect: 'none' }}
          >
            <span style={{ fontSize: 16 }}>∅</span>
            <span>no assignment</span>
          </div>
        </div>
      </div>
    </div>
  )
}
