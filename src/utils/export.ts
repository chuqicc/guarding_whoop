import type { CellAnnotation, TrackingFrame, PossessionMeta, Player, AttackerId } from '../store/useStore'

function resolveAttacker(id: AttackerId, playerDict: Record<number, Player>) {
  return id === 'GUARD_NONE' ? null : playerDict[id as number]
}

function bucketClocks(frames: TrackingFrame[], bucket: number) {
  const bf = frames.filter(
    f => f.shotClock !== null && !isNaN(f.shotClock!) && Math.floor(f.shotClock!) === bucket
  )
  if (bf.length === 0) return { quarterClockStart: null, quarterClockEnd: null, shotClockStart: null, shotClockEnd: null }
  return {
    quarterClockStart: Math.max(...bf.map(f => f.quarterClock)),
    quarterClockEnd:   Math.min(...bf.map(f => f.quarterClock)),
    shotClockStart:    Math.max(...bf.map(f => f.shotClock!)),
    shotClockEnd:      Math.min(...bf.map(f => f.shotClock!)),
  }
}

export function exportJSON(
  annotations: CellAnnotation[],
  frames: TrackingFrame[],
  possession: PossessionMeta,
  playerDict: Record<number, Player>
) {
  const defTeamAbbr = possession.teamA.teamId === possession.defendingTeamId
    ? possession.teamA.abbr : possession.teamB.abbr
  const attTeamAbbr = possession.teamA.teamId === possession.defendingTeamId
    ? possession.teamB.abbr : possession.teamA.abbr

  const data = {
    possession_id: possession.filename,
    game_id: possession.gameId,
    quarter: possession.quarter,
    possession_index: possession.possessionIndex,
    defending_team: defTeamAbbr,
    attacking_team: attTeamAbbr,
    quarter_clock_start: possession.startClock,
    quarter_clock_end: possession.endClock,
    exported_at: new Date().toISOString(),
    pairs: annotations.map(ann => {
      const defender = playerDict[ann.defenderId]
      const attacker = resolveAttacker(ann.attackerId, playerDict)
      const clocks = bucketClocks(frames, ann.shotClockBucket)
      return {
        id: ann.id,
        defender_id: ann.defenderId,
        defender_jersey: defender?.jersey ?? '?',
        defender_name: defender?.name ?? '?',
        attacker_id: ann.attackerId === 'GUARD_NONE' ? null : ann.attackerId,
        attacker_jersey: attacker?.jersey ?? null,
        attacker_name: ann.attackerId === 'GUARD_NONE' ? 'GUARD_NONE' : (attacker?.name ?? '?'),
        shot_clock_second: ann.shotClockBucket,
        shot_clock_start: clocks.shotClockStart !== null ? parseFloat(clocks.shotClockStart.toFixed(2)) : null,
        shot_clock_end:   clocks.shotClockEnd   !== null ? parseFloat(clocks.shotClockEnd.toFixed(2))   : null,
        quarter_clock_start: clocks.quarterClockStart !== null ? parseFloat(clocks.quarterClockStart.toFixed(2)) : null,
        quarter_clock_end:   clocks.quarterClockEnd   !== null ? parseFloat(clocks.quarterClockEnd.toFixed(2))   : null,
      }
    }),
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${possession.filename}_annotations.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportCSV(
  annotations: CellAnnotation[],
  frames: TrackingFrame[],
  possession: PossessionMeta,
  playerDict: Record<number, Player>
) {
  const headers = [
    'possession_id', 'quarter', 'defending_team', 'attacking_team',
    'defender_jersey', 'defender_name',
    'attacker_jersey', 'attacker_name',
    'shot_clock_second',
    'shot_clock_start', 'shot_clock_end',
    'quarter_clock_start', 'quarter_clock_end',
  ]

  const defTeamAbbr = possession.teamA.teamId === possession.defendingTeamId
    ? possession.teamA.abbr : possession.teamB.abbr
  const attTeamAbbr = possession.teamA.teamId === possession.defendingTeamId
    ? possession.teamB.abbr : possession.teamA.abbr

  const rows = annotations.map(ann => {
    const defender = playerDict[ann.defenderId]
    const attacker = resolveAttacker(ann.attackerId, playerDict)
    const clocks = bucketClocks(frames, ann.shotClockBucket)
    return [
      possession.filename,
      possession.quarter,
      defTeamAbbr,
      attTeamAbbr,
      defender?.jersey ?? '?',
      defender?.name ?? '?',
      attacker?.jersey ?? '',
      ann.attackerId === 'GUARD_NONE' ? 'GUARD_NONE' : (attacker?.name ?? '?'),
      ann.shotClockBucket,
      clocks.shotClockStart    !== null ? clocks.shotClockStart.toFixed(2)    : '',
      clocks.shotClockEnd      !== null ? clocks.shotClockEnd.toFixed(2)      : '',
      clocks.quarterClockStart !== null ? clocks.quarterClockStart.toFixed(2) : '',
      clocks.quarterClockEnd   !== null ? clocks.quarterClockEnd.toFixed(2)   : '',
    ].join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${possession.filename}_annotations.csv`
  a.click()
  URL.revokeObjectURL(url)
}
