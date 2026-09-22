import type { CellAnnotation, TrackingFrame, QuarterMeta, Player, AttackerId, AnnotationNote } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { getBucketDefendingTeamId } from './defenseTeam'
import { fmtClock } from './timelineScale'

type ExportMeta = QuarterMeta

// All export functions take the same bundle of inputs
export interface ExportInput {
  annotations: CellAnnotation[]
  deadTimeBuckets: number[]
  /**
   * What the dead-ball rules produced for this file (see utils/deriveDead).
   * Optional so older callers keep working. Both annotators get the identical
   * seed, so recording it is what lets a comparison separate "neither touched
   * the automatic result" from a real difference of judgement.
   */
  deadSeedBuckets?: number[]
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
  /** Present on dead buckets: did the rules mark this, or did the annotator? */
  dead_source?: 'auto' | 'manual'
  /** Present on active buckets the rules had marked dead and the annotator cleared. */
  auto_cleared?: true
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
  const { annotations, deadTimeBuckets, deadSeedBuckets, shotBuckets, reboundBuckets,
          frames, meta, playerDict, annotatorName, annotationSeconds, notes } = input
  const deadSet = new Set(deadTimeBuckets)
  const seedSet = new Set(deadSeedBuckets ?? [])

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
      if (deadSeedBuckets !== undefined) {
        if (isDead) row.dead_source = seedSet.has(bucket) ? 'auto' : 'manual'
        else if (seedSet.has(bucket)) row.auto_cleared = true
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

/**
 * `createdAt` as a local wall-clock time, with the UTC offset kept.
 *
 * The stored value is a UTC ISO string, which reads as a different hour — and
 * sometimes a different day — from when the note was actually written. The
 * offset stays on the end so the exact instant is still recoverable.
 */
export function fmtLocalTimestamp(iso: string): string {
  const d = new Date(iso)
  // An unparseable value is passed through rather than turned into "Invalid Date".
  if (isNaN(d.getTime())) return iso

  const p = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()        // minutes east of UTC
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} `
       + `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
}

/**
 * Notes as CSV.
 *
 * `clock` leads because it is the column a person reads: a note is about a
 * moment in the game, and "1:45.5" says where that is while the raw 105.5
 * seconds remaining does not. `bucket` stays alongside it as the key that
 * joins back to the annotation export.
 */
export function buildNotesCSV(
  notes: AnnotationNote[],
  meta: ExportMeta,
  playerDict: Record<number, Player>,
): string {
  const headers = [
    'game_id', 'quarter', 'clock', 'bucket',
    'defender_jersey', 'defender_name', 'text', 'created_at',
  ]

  // Chronological: the quarter clock counts down, so later notes have smaller
  // buckets. Unsorted they came out in the order they were typed, which after
  // any back-and-forth review bore no relation to the game.
  const rows = [...notes]
    .sort((a, b) => b.bucket - a.bucket)
    .map(n => {
      const defender = n.defenderId !== undefined ? playerDict[n.defenderId] : null
      return csvRow([
        meta.gameId,
        meta.quarter,
        fmtClock(n.bucket),
        n.bucket,
        defender?.jersey ?? '',
        defender?.name ?? '',
        n.text,
        fmtLocalTimestamp(n.createdAt),
      ])
    })

  return [headers.join(','), ...rows].join('\n')
}

export function exportNotesCSV(
  notes: AnnotationNote[],
  meta: ExportMeta,
  playerDict: Record<number, Player>
) {
  download(buildNotesCSV(notes, meta, playerDict), `${meta.filename}_notes.csv`, 'text/csv')
}

// ── Helper ─────────────────────────────────────────────────────────────────

export function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
