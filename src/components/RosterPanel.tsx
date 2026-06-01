import { useStore } from '../store/useStore'
import type { Player } from '../store/useStore'
import { COLOR_TEAM_A, COLOR_TEAM_B } from '../constants'

function PlayerButton({
  player,
  draggable,
  color,
}: {
  player: Player
  draggable: boolean
  color: string
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? e => {
        e.dataTransfer.setData('attackerId', String(player.id))
        useStore.getState().setPlaying(false)
      } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-inter)',
        border: `1px solid var(--border)`,
        borderRadius: 4, padding: '4px 8px', marginBottom: 4,
        cursor: draggable ? 'grab' : 'default',
        userSelect: 'none',
      }}
    >
      <span style={{ color, fontWeight: 700, fontSize: 15, minWidth: 26, flexShrink: 0 }}>
        #{player.jersey}
      </span>
      <span
        title={player.name}
        style={{ color: 'var(--text-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
      >
        {player.name}
      </span>
      {draggable && <span style={{ color: 'var(--text-4)', fontSize: 12 }}>⠿</span>}
    </div>
  )
}

export default function RosterPanel() {
  const possession      = useStore(s => s.possession)
  const quarterMeta     = useStore(s => s.quarterMeta)
  const toggleDefendingTeam = useStore(s => s.toggleDefendingTeam)
  const frames          = useStore(s => s.frames)
  const currentFrame    = useStore(s => s.currentFrame)

  const meta = possession ?? quarterMeta

  if (!meta) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', padding: 12, color: 'var(--text-3)', fontSize: 13 }}>
        No data loaded
      </div>
    )
  }

  const defTeam = meta.defendingTeamId === meta.teamA.teamId
    ? meta.teamA
    : meta.teamB
  const attTeam = meta.defendingTeamId === meta.teamA.teamId
    ? meta.teamB
    : meta.teamA

  // Colors follow the court: teamA always blue, teamB always red
  const defColor = defTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B
  const attColor = attTeam.teamId === meta.teamA.teamId ? COLOR_TEAM_A : COLOR_TEAM_B

  // Only show players currently on the court
  const onCourtIds = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const defPlayers = defTeam.players.filter(p => onCourtIds.has(p.id))
  const attPlayers = attTeam.players.filter(p => onCourtIds.has(p.id))

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Roster</span>
        <button
          onClick={toggleDefendingTeam}
          style={{
            background: '#2a3a5a', color: '#bbb', border: 'none',
            padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
          }}
        >
          ⇄ Swap teams
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Defense column */}
        <div style={{
          flex: 1, background: 'var(--bg-def)', padding: 8, overflowY: 'auto',
          borderRight: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 11, color: defColor, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>
            {defTeam.abbr} — Defense
          </div>
          {defPlayers.map(p => (
            <PlayerButton key={p.id} player={p} draggable={false} color={defColor} />
          ))}
        </div>

        {/* Attack column */}
        <div style={{
          flex: 1, background: 'var(--bg-att)', padding: 8, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, color: attColor, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>
            {attTeam.abbr} — Offense
          </div>
          {attPlayers.map(p => (
            <PlayerButton key={p.id} player={p} draggable={true} color={attColor} />
          ))}

          <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />

          {/* GUARD_NONE */}
          <div
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('attackerId', 'GUARD_NONE')
              useStore.getState().setPlaying(false)
            }}
            title="Drag here when defender has no specific assignment"
            style={{
              background: 'var(--bg-inter)', border: '1px dashed var(--border)',
              borderRadius: 4, padding: '4px 8px',
              color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic',
              cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>∅</span>
            <span>no assignment</span>
          </div>
        </div>
      </div>
    </div>
  )
}
