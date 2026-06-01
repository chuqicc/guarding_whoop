import type { TrackingFrame, Player, QuarterMeta } from '../store/useStore'

interface RawTeamInfo {
  name: string
  teamid: number
  abbreviation: string
  players: Array<{
    playerid: number
    jersey: string
    lastname: string
    firstname: string
    position: string
  }>
}

type RawEntity = [number, number, number, number, number]
type RawMoment = [number, number, number, number | null, null, RawEntity[]]

interface RawEvent {
  eventId: string
  visitor: RawTeamInfo
  home: RawTeamInfo
  moments: RawMoment[]
}

interface RawJSON {
  gameid: string
  gamedate: string
  quarter: number
  events: RawEvent[]
}

function buildPlayers(team: RawTeamInfo): Player[] {
  return team.players.map(p => ({
    id: p.playerid,
    name: `${p.firstname} ${p.lastname}`,
    jersey: String(parseInt(p.jersey, 10)),
    teamId: team.teamid,
    teamAbbr: team.abbreviation,
  }))
}

export function parseQuarterJSON(
  jsonText: string,
  filename: string
): {
  frames: TrackingFrame[]
  quarterMeta: QuarterMeta
  playerDict: Record<number, Player>
} {
  const raw: RawJSON = JSON.parse(jsonText)
  if (!raw.events?.length) throw new Error('No events found in JSON')

  const firstEvent = raw.events[0]

  // Collect all moments from all events, sort by timestamp, deduplicate
  const allMoments: RawMoment[] = []
  for (const event of raw.events) {
    for (const m of event.moments) allMoments.push(m)
  }
  allMoments.sort((a, b) => a[1] - b[1])

  const seen = new Set<number>()
  const deduped = allMoments.filter(m => {
    if (seen.has(m[1])) return false
    seen.add(m[1])
    return true
  })

  const frames: TrackingFrame[] = deduped.map((m, i) => {
    const [, momentId, gameClock, shotClock, , entities] = m
    const ball = entities.find(e => e[0] === -1)
    return {
      frameIndex: i,
      momentId,
      quarterClock: gameClock,
      shotClock: shotClock ?? null,
      ballX: ball ? ball[2] : 0,
      ballY: ball ? ball[3] : 0,
      ballZ: ball ? ball[4] : 0,
      players: entities
        .filter(e => e[0] !== -1)
        .map(e => ({ id: e[1], teamId: e[0], x: e[2], y: e[3] })),
    }
  })

  const homePlayers = buildPlayers(firstEvent.home)
  const visitorPlayers = buildPlayers(firstEvent.visitor)

  const playerDict: Record<number, Player> = {}
  for (const p of [...homePlayers, ...visitorPlayers]) playerDict[p.id] = p

  const quarterMeta: QuarterMeta = {
    filename: filename.replace(/\.json$/i, ''),
    gameId: raw.gameid,
    quarter: raw.quarter,
    teamA: { teamId: firstEvent.home.teamid, abbr: firstEvent.home.abbreviation, players: homePlayers },
    teamB: { teamId: firstEvent.visitor.teamid, abbr: firstEvent.visitor.abbreviation, players: visitorPlayers },
    defendingTeamId: firstEvent.home.teamid,
    totalFrames: frames.length,
    startClock: frames.length > 0 ? frames[0].quarterClock : 720,
    endClock:   frames.length > 0 ? frames[frames.length - 1].quarterClock : 0,
  }

  return { frames, quarterMeta, playerDict }
}
