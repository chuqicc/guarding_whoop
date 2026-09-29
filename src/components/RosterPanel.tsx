import { useStore } from '../store/useStore'
import { useTeamColors } from '../utils/teamColors'

/**
 * A team's column heading, with its colour swatch.
 *
 * Declared at module scope, not inside RosterPanel: a component created during
 * render is a new type on every pass, so React unmounts and remounts the
 * subtree — which would tear down the open colour picker the moment the value
 * changed, making it impossible to drag through a gradient.
 */
function TeamHeading({ abbr, role, color, onPick }: {
  abbr: string
  role: string
  color: string
  onPick: (hex: string) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <input
        type="color"
        className="team-swatch"
        value={color}
        onChange={e => onPick(e.target.value)}
        title={`${abbr} colour — set it to match the shirts in the video`}
        aria-label={`${abbr} team colour`}
      />
      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase' }}>
        {abbr} — {role}
      </span>
    </div>
  )
}

export default function RosterPanel() {
  const teamColors = useTeamColors()
  const quarterMeta         = useStore(s => s.quarterMeta)
  const toggleDefendingTeam = useStore(s => s.toggleDefendingTeam)
  const setTeamColor        = useStore(s => s.setTeamColor)
  const resetTeamColors     = useStore(s => s.resetTeamColors)
  const overrides           = useStore(s => s.teamColors)
  const frames              = useStore(s => s.frames)
  const currentFrame        = useStore(s => s.currentFrame)

  const meta = quarterMeta

  if (!meta) {
    return (
      <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', padding: 12, color: 'var(--text-3)', fontSize: 13 }}>
        No data loaded
      </div>
    )
  }

  const defTeam  = meta.defendingTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
  const attTeam  = meta.defendingTeamId === meta.teamA.teamId ? meta.teamB : meta.teamA
  const defColor = defTeam.teamId === meta.teamA.teamId ? teamColors.a : teamColors.b
  const attColor = attTeam.teamId === meta.teamA.teamId ? teamColors.a : teamColors.b

  // Which stored slot a team occupies. The DEF/ATT columns swap with
  // possession, but a team's colour must not: it is a property of the shirt.
  const sideOf = (teamId: number): 'a' | 'b' => teamId === meta.teamA.teamId ? 'a' : 'b'

  const onCourtIds = new Set((frames[currentFrame]?.players ?? []).map(p => p.id))
  const defPlayers = defTeam.players.filter(p => onCourtIds.has(p.id))
  const attPlayers = attTeam.players.filter(p => onCourtIds.has(p.id))

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Roster</span>
          {(overrides.a || overrides.b) && (
            <button
              onClick={resetTeamColors}
              title="Restore the default team colours"
              aria-label="Reset team colours"
              style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 12, padding: 0 }}
            >
              ↺
            </button>
          )}
        </div>
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
          <TeamHeading
            abbr={defTeam.abbr} role="Defense" color={defColor}
            onPick={hex => setTeamColor(sideOf(defTeam.teamId), hex)}
          />
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
          <TeamHeading
            abbr={attTeam.abbr} role="Offense" color={attColor}
            onPick={hex => setTeamColor(sideOf(attTeam.teamId), hex)}
          />
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
