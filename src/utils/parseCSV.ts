import type { Player, TrackingFrame, PossessionMeta } from '../store/useStore'

// ── player_data.csv ───────────────────────────────────────────────────────

export function parsePlayerDict(csvText: string): Record<number, Player> {
  const lines = csvText.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const dict: Record<number, Player> = {}

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i], headers)
    if (!row.player_id) continue
    const pid = parseInt(row.player_id)
    dict[pid] = {
      id: pid,
      name: (row.player_name || '').trim(),
      jersey: String(parseInt(row.jersey_number) || 0),
      teamId: parseInt(row.team_id),
      teamAbbr: (row.team || '???').trim().toUpperCase(),
    }
  }
  return dict
}

// ── possession CSV ────────────────────────────────────────────────────────

export function parsePossession(
  csvText: string,
  filename: string,          // e.g. "0021500001_1_2"
  playerDict: Record<number, Player>
): { frames: TrackingFrame[]; possession: PossessionMeta } {

  // Parse filename: {gameId}_{quarter}_{possessionIndex}
  const parts = filename.replace('.csv', '').split('_')
  const gameId = parts.slice(0, -2).join('_')   // handles gameIds with underscores
  const quarter = parseInt(parts[parts.length - 2])
  const possessionIndex = parseInt(parts[parts.length - 1])

  const lines = csvText.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const frames: TrackingFrame[] = []

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i], headers)
    const players: TrackingFrame['players'] = []

    for (let n = 1; n <= 10; n++) {
      const pid = parseFloat(row[`player_${n}_id`])
      const tid = parseFloat(row[`player_${n}_team_id`])
      const px  = parseFloat(row[`player_${n}_x`])
      const py  = parseFloat(row[`player_${n}_y`])
      if (isNaN(pid) || isNaN(px) || isNaN(py)) continue
      players.push({ id: Math.round(pid), teamId: Math.round(tid), x: px, y: py })
    }

    frames.push({
      frameIndex: i - 1,
      quarterClock: parseFloat(row.quarter_clock),
      shotClock: isNaN(parseFloat(row.shot_clock)) ? null : parseFloat(row.shot_clock),
      ballX: parseFloat(row.ball_x),
      ballY: parseFloat(row.ball_y),
      ballZ: parseFloat(row.ball_radius),
      players,
    })
  }

  if (frames.length === 0) throw new Error('No frames parsed from CSV')

  // Determine teams from first frame (slots 1-5 = teamA, 6-10 = teamB)
  const firstFrame = frames[0]
  const teamAId = firstFrame.players[0]?.teamId ?? 0
  const teamBId = firstFrame.players[5]?.teamId ?? 0

  const getAbbr = (tid: number) => {
    for (const p of Object.values(playerDict)) {
      if (p.teamId === tid) return p.teamAbbr
    }
    return 'T' + tid
  }

  const teamAPlayers = firstFrame.players.slice(0, 5).map(p => playerDict[p.id]).filter(Boolean)
  const teamBPlayers = firstFrame.players.slice(5, 10).map(p => playerDict[p.id]).filter(Boolean)

  const possession: PossessionMeta = {
    filename: filename.replace('.csv', ''),
    gameId,
    quarter,
    possessionIndex,
    teamA: { teamId: teamAId, abbr: getAbbr(teamAId), players: teamAPlayers },
    teamB: { teamId: teamBId, abbr: getAbbr(teamBId), players: teamBPlayers },
    defendingTeamId: teamAId,   // default: teamA defends; user can swap
    totalFrames: frames.length,
    startClock: frames[0].quarterClock,
    endClock: frames[frames.length - 1].quarterClock,
  }

  return { frames, possession }
}

// ── helper ────────────────────────────────────────────────────────────────

function parseRow(line: string, headers: string[]): Record<string, string> {
  const values = line.split(',')
  const row: Record<string, string> = {}
  headers.forEach((h, i) => { row[h] = (values[i] || '').trim() })
  return row
}
