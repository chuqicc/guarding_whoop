import type { CellAnnotation, TrackingFrame, PossessionMeta, QuarterMeta, Player, AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'

type ExportMeta = PossessionMeta | QuarterMeta

function resolveAttacker(id: AttackerId, playerDict: Record<number, Player>) {
  return id === 'GUARD_NONE' ? null : playerDict[id as number]
}

function isPossession(meta: ExportMeta): meta is PossessionMeta {
  return 'possessionIndex' in meta
}

function getFrameBucket(frame: TrackingFrame, isQuarter: boolean): number | null {
  if (isQuarter) return Math.floor(frame.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
  return frame.shotClock !== null && !isNaN(frame.shotClock) ? Math.floor(frame.shotClock) : null
}

// ── Per-frame JSON export (nested structure) ──────────────────────────────
// Structure: { metadata, frames: [ { frame, moment_id, quarter_clock,
//   shot_clock, gamestatus, assignments: [ {defender…, attacker…} ] } ] }

export function exportJSON(
  annotations: CellAnnotation[],
  deadTimeBuckets: number[],
  frames: TrackingFrame[],
  meta: ExportMeta,
  playerDict: Record<number, Player>
) {
  const isPoss      = isPossession(meta)
  const defTeamAbbr = meta.teamA.teamId === meta.defendingTeamId ? meta.teamA.abbr : meta.teamB.abbr
  const attTeamAbbr = meta.teamA.teamId === meta.defendingTeamId ? meta.teamB.abbr : meta.teamA.abbr
  const deadSet     = new Set(deadTimeBuckets)

  type Assignment = {
    defender_jersey: string
    defender_id: number
    defender_name: string
    attacker_jersey: string | null
    attacker_id: number | 'GUARD_NONE' | null
    attacker_name: string | null
  }

  type FrameRow = {
    frame: number
    moment_id: number | null
    quarter_clock: number
    shot_clock: number | null
    gamestatus: 'active' | 'dead'
    defending_team: string | null
    attacking_team: string | null
    assignments: Assignment[]
  }

  const frameRows: FrameRow[] = []

  for (const frame of frames) {
    const bucket = getFrameBucket(frame, !isPoss)
    if (bucket === null) continue

    const isDead = deadSet.has(bucket)

    if (isDead) {
      frameRows.push({
        frame:          frame.frameIndex,
        moment_id:      frame.momentId ?? null,
        quarter_clock:  parseFloat(frame.quarterClock.toFixed(2)),
        shot_clock:     frame.shotClock !== null ? parseFloat(frame.shotClock.toFixed(2)) : null,
        gamestatus:     'dead',
        defending_team: null,
        attacking_team: null,
        assignments:    [],
      })
    } else {
      const onCourtIds = new Set(frame.players.map(p => p.id))
      const defPlayers = (meta.defendingTeamId === meta.teamA.teamId
        ? meta.teamA.players
        : meta.teamB.players
      ).filter(p => onCourtIds.has(p.id))

      const assignments: Assignment[] = defPlayers.map(defender => {
        const ann      = annotations.find(c => c.defenderId === defender.id && c.shotClockBucket === bucket)
        const attacker = ann ? resolveAttacker(ann.attackerId, playerDict) : null
        const isNone   = ann?.attackerId === 'GUARD_NONE'
        return {
          defender_jersey: defender.jersey,
          defender_id:     defender.id,
          defender_name:   defender.name,
          attacker_jersey: attacker?.jersey ?? null,
          attacker_id:     isNone ? 'GUARD_NONE' : (ann ? ann.attackerId as number : null),
          attacker_name:   isNone ? 'GUARD_NONE' : (attacker?.name ?? null),
        }
      })

      frameRows.push({
        frame:          frame.frameIndex,
        moment_id:      frame.momentId ?? null,
        quarter_clock:  parseFloat(frame.quarterClock.toFixed(2)),
        shot_clock:     frame.shotClock !== null ? parseFloat(frame.shotClock.toFixed(2)) : null,
        gamestatus:     'active',
        defending_team: defTeamAbbr,
        attacking_team: attTeamAbbr,
        assignments,
      })
    }
  }

  const output = {
    metadata: {
      game_id:      meta.gameId,
      quarter:      meta.quarter,
      exported_at:  new Date().toISOString(),
      total_frames: frameRows.length,
    },
    frames: frameRows,
  }

  download(JSON.stringify(output, null, 2), `${meta.filename}_annotations.json`, 'application/json')
}

// ── Per-frame detailed CSV export ─────────────────────────────────────────
// One row per (frame × on-court defender).
// Fields: gameid, momentid, frame, quarter, quarter_clock, shot_clock,
//         defending_team, attacking_team,
//         defender_jersey, defender_name, defender_id,
//         attacker_jersey, attacker_id, game_status

export function exportFrameCSV(
  annotations: CellAnnotation[],
  deadTimeBuckets: number[],
  frames: TrackingFrame[],
  meta: ExportMeta,
  playerDict: Record<number, Player>
) {
  const isPoss      = isPossession(meta)
  const defTeamAbbr = meta.teamA.teamId === meta.defendingTeamId ? meta.teamA.abbr : meta.teamB.abbr
  const attTeamAbbr = meta.teamA.teamId === meta.defendingTeamId ? meta.teamB.abbr : meta.teamA.abbr
  const deadSet     = new Set(deadTimeBuckets)

  const headers = [
    'game_id', 'quarter', 'frame', 'moment_id', 'gamestatus',
    'defending_team', 'attacking_team',
    'defender_jersey', 'defender_id', 'defender_name',
    'attacker_jersey', 'attacker_id', 'attacker_name',
    'quarter_clock', 'shot_clock',
  ]

  const rows: string[] = []

  for (const frame of frames) {
    const bucket = getFrameBucket(frame, !isPoss)
    if (bucket === null) continue

    const isDead = deadSet.has(bucket)
    const base = [
      meta.gameId,
      meta.quarter,
      frame.frameIndex,
      frame.momentId ?? '',      // moment_id — links row to SportVU tracking moment
      isDead ? 'dead' : 'active',
    ]

    if (isDead) {
      // 5 blank rows per dead frame — maintain structure, no assignment info during dead ball
      for (let i = 0; i < 5; i++) {
        rows.push([...base, '', '', '', '', '', '', '', '', '', ''].join(','))
      }
    } else {
      const onCourtIds = new Set(frame.players.map(p => p.id))
      const defPlayers = (meta.defendingTeamId === meta.teamA.teamId
        ? meta.teamA.players
        : meta.teamB.players
      ).filter(p => onCourtIds.has(p.id))

      for (const defender of defPlayers) {
        const ann      = annotations.find(c => c.defenderId === defender.id && c.shotClockBucket === bucket)
        const attacker = ann ? resolveAttacker(ann.attackerId, playerDict) : null
        const isNone   = ann?.attackerId === 'GUARD_NONE'
        const attId    = isNone ? 'GUARD_NONE' : (ann ? String(ann.attackerId) : '')
        const attName  = isNone ? 'GUARD_NONE' : (attacker?.name ?? '')

        rows.push([
          ...base,
          defTeamAbbr,
          attTeamAbbr,
          defender.jersey,
          defender.id,
          defender.name,
          attacker?.jersey ?? '',
          attId,
          attName,
          frame.quarterClock.toFixed(2),
          frame.shotClock !== null ? frame.shotClock.toFixed(2) : '',
        ].join(','))
      }
    }
  }

  download([headers.join(','), ...rows].join('\n'), `${meta.filename}_frame_annotations.csv`, 'text/csv')
}

// ── Helper ─────────────────────────────────────────────────────────────────

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
