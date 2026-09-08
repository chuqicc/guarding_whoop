import type { CellAnnotation, TrackingFrame, QuarterMeta, Player, AttackerId, AnnotationNote } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { getBucketDefendingTeamId } from './defenseTeam'

type ExportMeta = QuarterMeta

// All export functions take the same bundle of inputs
export interface ExportInput {
  annotations: CellAnnotation[]
  deadTimeBuckets: number[]
  shotBuckets: number[]
  reboundBuckets: number[]
  frames: TrackingFrame[]
  meta: ExportMeta
  playerDict: Record<number, Player>
  annotatorName: string
  annotationSeconds: number
  notes: AnnotationNote[]
}

function resolveAttacker(id: AttackerId, playerDict: Record<number, Player>) {
  return id === 'GUARD_NONE' ? null : playerDict[id as number]
}

// RFC4180 quoting. Player names legitimately contain commas ("Smith, Jr."),
// which silently corrupted every downstream parse of the frame CSV.
export function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',')
}

function getFrameBucket(frame: TrackingFrame): number {
  return Math.floor(frame.quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S
}

// ── Concise bucket-based JSON export (format v2) ──────────────────────────
// One entry per shot-clock/quarter-clock bucket instead of one per frame
// (the old per-frame layout repeated every assignment ~25× per second).
// Player names/jerseys live once in meta.players, assignments reference ids.
//   assignments[].att : player id | "NONE" (explicitly guarding no one)
//                       | null (defender not annotated in this bucket)
//   assignments[].conf: omitted when 3 (= certain, the default)

export interface ExportBucketRow {
  bucket: number
  status: 'active' | 'dead'
  frame_start: number
  frame_end: number
  quarter_clock: number
  shot_clock?: number
  moment_start?: number
  moment_end?: number
  events?: Array<'shot' | 'rebound'>
  def_team?: string
  att_team?: string
  assignments?: Array<{ def: number; att: number | 'NONE' | null; conf?: 1 | 2 }>
}

export function buildAnnotationExport(input: ExportInput) {
  const { annotations, deadTimeBuckets, shotBuckets, reboundBuckets,
          frames, meta, playerDict, annotatorName, annotationSeconds, notes } = input
  const deadSet = new Set(deadTimeBuckets)

  // Group frames by bucket, keeping chronological extents
  interface Grp {
    frameStart: number; frameEnd: number
    qcMax: number; scMax: number | null
    momentStart?: number; momentEnd?: number
    // Union across every frame in the bucket, not just the first — a player
    // subbed in mid-bucket must not lose their annotation.
    onCourt: Set<number>
  }
  const groups = new Map<number, Grp>()
  for (const f of frames) {
    const b = getFrameBucket(f)
    if (b === null) continue
    const g = groups.get(b)
    if (!g) {
      groups.set(b, {
        frameStart: f.frameIndex, frameEnd: f.frameIndex,
        qcMax: f.quarterClock,
        scMax: f.shotClock !== null && !isNaN(f.shotClock) ? f.shotClock : null,
        momentStart: f.momentId, momentEnd: f.momentId,
        onCourt: new Set(f.players.map(p => p.id)),
      })
    } else {
      for (const p of f.players) g.onCourt.add(p.id)
      if (f.frameIndex < g.frameStart) { g.frameStart = f.frameIndex; g.momentStart = f.momentId ?? g.momentStart }
      if (f.frameIndex > g.frameEnd)   { g.frameEnd = f.frameIndex; g.momentEnd = f.momentId ?? g.momentEnd }
      if (f.quarterClock > g.qcMax) g.qcMax = f.quarterClock
      if (f.shotClock !== null && !isNaN(f.shotClock) && (g.scMax === null || f.shotClock > g.scMax)) g.scMax = f.shotClock
    }
  }

  const bucketRows: ExportBucketRow[] = [...groups.entries()]
    .sort((a, b) => a[1].frameStart - b[1].frameStart)   // chronological
    .map(([bucket, g]) => {
      const isDead = deadSet.has(bucket)
      const row: ExportBucketRow = {
        bucket,
        status:       isDead ? 'dead' : 'active',
        frame_start:  g.frameStart,
        frame_end:    g.frameEnd,
        quarter_clock: parseFloat(g.qcMax.toFixed(2)),
      }
      if (g.scMax !== null)            row.shot_clock   = parseFloat(g.scMax.toFixed(2))
      if (g.momentStart !== undefined) row.moment_start = g.momentStart
      if (g.momentEnd !== undefined)   row.moment_end   = g.momentEnd

      const events: Array<'shot' | 'rebound'> = []
      if (shotBuckets.includes(bucket))    events.push('shot')
      if (reboundBuckets.includes(bucket)) events.push('rebound')
      if (events.length > 0) row.events = events

      const bDefTeamId = getBucketDefendingTeamId(bucket, annotations, playerDict, meta.defendingTeamId)
      const bDefTeam   = bDefTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
      const bAttTeam   = bDefTeamId === meta.teamA.teamId ? meta.teamB : meta.teamA
      row.def_team = bDefTeam.abbr
      row.att_team = bAttTeam.abbr

      // Every defender we must report on: the defending team's on-court
      // players, plus anyone actually annotated in this bucket. The latter
      // covers the "historical" rows the UI keeps for the other team after a
      // defense swap, which were previously stored but never exported.
      const annotatedHere = annotations.filter(c => c.shotClockBucket === bucket)
      const defenderIds: number[] = []
      const seen = new Set<number>()
      for (const p of bDefTeam.players) {
        if (g.onCourt.has(p.id) && !seen.has(p.id)) { seen.add(p.id); defenderIds.push(p.id) }
      }
      for (const c of annotatedHere) {
        if (!seen.has(c.defenderId)) { seen.add(c.defenderId); defenderIds.push(c.defenderId) }
      }

      // Dead buckets keep status:'dead' but still report what was recorded.
      // Silently deleting an annotator's work at export time is never correct.
      row.assignments = defenderIds.map(defId => {
        const ann = annotatedHere.find(c => c.defenderId === defId)
        const entry: NonNullable<ExportBucketRow['assignments']>[number] = {
          def: defId,
          att: ann ? (ann.attackerId === 'GUARD_NONE' ? 'NONE' : ann.attackerId) : null,
        }
        if (ann && (ann.confidence === 1 || ann.confidence === 2)) entry.conf = ann.confidence
        return entry
      })
      return row
    })

  // Players referenced anywhere (both rosters) — names/jerseys stored once
  // Integrity gate. Every annotation the store holds must appear in the export.
  // Three separate bugs used to drop cells here silently; a wrong number in a
  // published result is far worse than a failed export, so refuse instead.
  {
    const exported = new Set<string>()
    for (const row of bucketRows) {
      for (const a of row.assignments ?? []) {
        if (a.att !== null) exported.add(`${a.def}_${row.bucket}`)
      }
    }
    const missing = annotations
      .map(c => `${c.defenderId}_${c.shotClockBucket}`)
      .filter(k => !exported.has(k))
    if (missing.length > 0) {
      const unique = [...new Set(missing)]
      throw new Error(
        `Export aborted: ${unique.length} recorded assignment(s) would be lost ` +
        `(defenderId_bucket): ${unique.slice(0, 10).join(', ')}` +
        `${unique.length > 10 ? ', …' : ''}. ` +
        `This usually means an annotation exists for a bucket with no tracking frames.`
      )
    }
  }

  const players: Record<string, { name: string; jersey: string; team: string }> = {}
  for (const team of [meta.teamA, meta.teamB]) {
    for (const p of team.players) {
      players[String(p.id)] = { name: p.name, jersey: p.jersey, team: team.abbr }
    }
  }

  return {
    format: 'guard-annotation/v2',
    meta: {
      game_id:     meta.gameId,
      quarter:     meta.quarter,
      mode:        'quarter',
      source_file: meta.filename,
      bucket_unit: `quarter_clock_${QUARTER_BUCKET_S}s`,
      teams:       [ { id: meta.teamA.teamId, abbr: meta.teamA.abbr },
                     { id: meta.teamB.teamId, abbr: meta.teamB.abbr } ],
      players,
      annotator:          annotatorName,
      annotation_seconds: annotationSeconds,
      exported_at:        new Date().toISOString(),
      ...(notes.length > 0 ? { notes } : {}),
    },
    buckets: bucketRows,
  }
}

export function exportJSON(input: ExportInput) {
  const output = buildAnnotationExport(input)
  download(JSON.stringify(output, null, 2), `${input.meta.filename}_annotations.json`, 'application/json')
}

// ── Per-frame detailed CSV export ─────────────────────────────────────────
// One row per (frame × on-court defender). Unchanged layout, plus the two
// event columns is_shot / is_rebound (1/0, bucket-level flags).

export function buildFrameCSV(input: ExportInput): string {
  const { annotations, deadTimeBuckets, shotBuckets, reboundBuckets,
          frames, meta, playerDict, annotatorName } = input
  const deadSet = new Set(deadTimeBuckets)

  const headers = [
    'game_id', 'quarter', 'frame', 'moment_id', 'gamestatus',
    'defending_team', 'attacking_team',
    'defender_jersey', 'defender_id', 'defender_name',
    'attacker_jersey', 'attacker_id', 'attacker_name', 'confidence',
    'quarter_clock', 'shot_clock', 'is_shot', 'is_rebound', 'annotator',
  ]

  const rows: string[] = []

  for (const frame of frames) {
    const bucket = getFrameBucket(frame)
    if (bucket === null) continue

    const isDead    = deadSet.has(bucket)
    const isShot    = shotBuckets.includes(bucket) ? '1' : '0'
    const isRebound = reboundBuckets.includes(bucket) ? '1' : '0'
    const base = [
      meta.gameId,
      meta.quarter,
      frame.frameIndex,
      frame.momentId ?? '',      // moment_id — links row to SportVU tracking moment
      isDead ? 'dead' : 'active',
    ]
    const tail = [
      frame.quarterClock.toFixed(2),
      frame.shotClock !== null ? frame.shotClock.toFixed(2) : '',
      isShot,
      isRebound,
      annotatorName,
    ]

    const bDefTeamId = getBucketDefendingTeamId(bucket, annotations, playerDict, meta.defendingTeamId)
    const bDefTeam   = bDefTeamId === meta.teamA.teamId ? meta.teamA : meta.teamB
    const bAttTeam   = bDefTeamId === meta.teamA.teamId ? meta.teamB : meta.teamA

    const onCourtIds  = new Set(frame.players.map(p => p.id))
    const annotatedHere = annotations.filter(c => c.shotClockBucket === bucket)

    const defenderIds: number[] = []
    const seenDef = new Set<number>()
    for (const p of bDefTeam.players) {
      if (onCourtIds.has(p.id) && !seenDef.has(p.id)) { seenDef.add(p.id); defenderIds.push(p.id) }
    }
    for (const c of annotatedHere) {
      if (!seenDef.has(c.defenderId)) { seenDef.add(c.defenderId); defenderIds.push(c.defenderId) }
    }

    if (defenderIds.length === 0) {
      rows.push(csvRow([...base, '', '', '', '', '', '', '', '', '', ...tail]))
      continue
    }

    for (const defId of defenderIds) {
      const defender = playerDict[defId]
      const ann      = annotatedHere.find(c => c.defenderId === defId)
      const attacker = ann ? resolveAttacker(ann.attackerId, playerDict) : null
      const isNone   = ann?.attackerId === 'GUARD_NONE'
      const attJersey = isNone ? 'GUARD_NONE' : (attacker?.jersey ?? '')
      const attId    = isNone ? 'GUARD_NONE' : (ann ? String(ann.attackerId) : '')
      const attName  = isNone ? 'GUARD_NONE' : (attacker?.name ?? '')

      rows.push(csvRow([
        ...base,
        bDefTeam.abbr,
        bAttTeam.abbr,
        defender?.jersey ?? '',
        defId,
        defender?.name ?? '',
        attJersey,
        attId,
        attName,
        ann?.confidence ?? 3,
        ...tail,
      ]))
    }
  }

  return [headers.join(','), ...rows].join('\n')
}

export function exportFrameCSV(input: ExportInput) {
  download(buildFrameCSV(input), `${input.meta.filename}_frame_annotations.csv`, 'text/csv')
}

// ── Notes export ───────────────────────────────────────────────────────────

export function exportNotesCSV(
  notes: AnnotationNote[],
  meta: ExportMeta,
  playerDict: Record<number, Player>
) {
  const headers = ['game_id', 'quarter', 'bucket', 'defender_jersey', 'defender_name', 'text', 'created_at']

  const rows = notes.map(n => {
    const defender = n.defenderId !== undefined ? playerDict[n.defenderId] : null
    return csvRow([
      meta.gameId,
      meta.quarter,
      n.bucket,
      defender?.jersey ?? '',
      defender?.name ?? '',
      n.text,
      n.createdAt,
    ])
  })

  download([headers.join(','), ...rows].join('\n'), `${meta.filename}_notes.csv`, 'text/csv')
}

// ── Helper ─────────────────────────────────────────────────────────────────

export function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
