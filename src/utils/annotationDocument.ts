import type { AttackerId } from '../store/useStore'
import { QUARTER_BUCKET_S } from '../constants'
import { parseCSVTable } from './csv'

/**
 * A normalised view of one annotator's finished work on one quarter.
 *
 * Both export formats collapse into this shape so the comparison logic only
 * has to understand one thing — and so two annotators who exported in
 * different formats can still be compared against each other.
 *
 * The existing importers (parseAnnotationJSON / parseAnnotationCSV) were built
 * to *resume a session*, so they keep only the annotations and throw away the
 * annotator, the game/quarter identity, the rosters and the defending team.
 * Comparison needs all of those, which is why this parser exists rather than
 * bolting fields onto the resume path.
 */
export interface DocumentBucket {
  status: 'active' | 'dead'
  defTeam?: string
  frameStart?: number
  /** defenderId -> the attacker they were marking. Absent = not annotated. */
  assignments: Map<number, AttackerId>
  confidence: Map<number, 1 | 2 | 3>
  shot: boolean
  rebound: boolean
}

export interface AnnotationDocument {
  annotator: string
  gameId: string
  quarter: number
  sourceFile: string
  sourceFormat: 'json' | 'csv'
  exportedAt?: string
  players: Record<number, { name: string; jersey: string; team?: string }>
  buckets: Map<number, DocumentBucket>
}

export class UnsupportedAnnotationFile extends Error {}

const bucketOf = (quarterClock: number) =>
  Math.round(Math.floor(quarterClock / QUARTER_BUCKET_S) * QUARTER_BUCKET_S * 1e6) / 1e6

function emptyBucket(): DocumentBucket {
  return { status: 'active', assignments: new Map(), confidence: new Map(), shot: false, rebound: false }
}

export function parseAnnotationDocument(text: string, filename = ''): AnnotationDocument {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{')
    ? fromJSON(trimmed, filename)
    : fromCSV(text, filename)
}

// ── JSON (guard-annotation/v2) ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromJSON(text: string, filename: string): AnnotationDocument {
  let data: any
  try { data = JSON.parse(text) } catch (e) {
    throw new UnsupportedAnnotationFile(`Not valid JSON: ${String(e)}`)
  }

  if (!Array.isArray(data?.buckets)) {
    // v1 (per-frame) and the legacy pairs format carry no annotator and no
    // defending team, so there is nothing to compare on.
    throw new UnsupportedAnnotationFile(
      'This file is an older annotation format that does not record the annotator ' +
      'or the defending team. Re-export it from the current version before comparing.',
    )
  }

  const meta = data.meta ?? {}
  const players: AnnotationDocument['players'] = {}
  for (const [id, p] of Object.entries<any>(meta.players ?? {})) {
    const n = Number(id)
    if (!isNaN(n)) players[n] = { name: p?.name ?? '', jersey: String(p?.jersey ?? ''), team: p?.team }
  }

  const buckets = new Map<number, DocumentBucket>()
  for (const row of data.buckets) {
    const bucket = Number(row?.bucket)
    if (isNaN(bucket)) continue

    const b = emptyBucket()
    b.status = row.status === 'dead' ? 'dead' : 'active'
    if (typeof row.def_team === 'string') b.defTeam = row.def_team
    if (typeof row.frame_start === 'number') b.frameStart = row.frame_start
    if (Array.isArray(row.events)) {
      b.shot = row.events.includes('shot')
      b.rebound = row.events.includes('rebound')
    }

    for (const a of row.assignments ?? []) {
      if (a?.att === null || a?.att === undefined) continue   // defender not annotated
      const def = Number(a.def)
      if (isNaN(def)) continue
      const att: AttackerId = a.att === 'NONE' || a.att === 'GUARD_NONE' ? 'GUARD_NONE' : Number(a.att)
      if (typeof att === 'number' && isNaN(att)) continue
      b.assignments.set(def, att)
      const conf = a.conf ?? a.confidence
      if (conf === 1 || conf === 2 || conf === 3) b.confidence.set(def, conf)
    }
    buckets.set(bucket, b)
  }

  return {
    annotator:   String(meta.annotator ?? '').trim(),
    gameId:      String(meta.game_id ?? ''),
    quarter:     Number(meta.quarter ?? 0),
    sourceFile:  String(meta.source_file ?? filename),
    sourceFormat: 'json',
    exportedAt:  meta.exported_at,
    players,
    buckets,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── CSV (the per-frame export) ─────────────────────────────────────────────

function fromCSV(text: string, filename: string): AnnotationDocument {
  const { headers, rows } = parseCSVTable(text)
  const col = (name: string) => headers.indexOf(name)

  const iGame = col('game_id')
  const iQuarter = col('quarter')
  const iFrame = col('frame')
  const iStatus = col('gamestatus')
  const iDefTeam = col('defending_team')
  const iDefId = col('defender_id')
  const iDefJersey = col('defender_jersey')
  const iDefName = col('defender_name')
  const iAttId = col('attacker_id')
  const iAttJersey = col('attacker_jersey')
  const iAttName = col('attacker_name')
  const iConf = col('confidence')
  const iQClock = col('quarter_clock')
  const iAnnotator = col('annotator')
  const iShot = col('is_shot')
  const iRebound = col('is_rebound')

  if (iQClock === -1 || iDefId === -1 || iAttId === -1) {
    throw new UnsupportedAnnotationFile(
      'This CSV is missing the columns needed to compare annotations ' +
      '(quarter_clock, defender_id, attacker_id). Export the per-frame CSV, not the notes CSV.',
    )
  }

  const players: AnnotationDocument['players'] = {}
  const buckets = new Map<number, DocumentBucket>()
  let annotator = '', gameId = '', quarter = 0

  const notePlayer = (id: number, jersey: string, name: string, team?: string) => {
    if (isNaN(id)) return
    if (!players[id]) players[id] = { name, jersey, team }
  }

  for (const cols of rows) {
    const qc = parseFloat(cols[iQClock])
    if (isNaN(qc)) continue
    const bucket = bucketOf(qc)

    let b = buckets.get(bucket)
    if (!b) { b = emptyBucket(); buckets.set(bucket, b) }

    if (iStatus !== -1 && cols[iStatus] === 'dead') b.status = 'dead'
    if (iDefTeam !== -1 && cols[iDefTeam]) b.defTeam = cols[iDefTeam]
    if (iShot !== -1 && cols[iShot] === '1') b.shot = true
    if (iRebound !== -1 && cols[iRebound] === '1') b.rebound = true

    if (iFrame !== -1) {
      const f = parseInt(cols[iFrame])
      if (!isNaN(f) && (b.frameStart === undefined || f < b.frameStart)) b.frameStart = f
    }

    if (!annotator && iAnnotator !== -1 && cols[iAnnotator]) annotator = cols[iAnnotator].trim()
    if (!gameId && iGame !== -1) gameId = cols[iGame] ?? ''
    if (!quarter && iQuarter !== -1) {
      const q = parseInt(cols[iQuarter]); if (!isNaN(q)) quarter = q
    }

    // Dead frames used to be exported as blank placeholder rows; they now carry
    // real defenders. Both shapes have to load, so skip rows with no defender.
    const defId = parseInt(cols[iDefId])
    if (isNaN(defId)) continue
    notePlayer(defId, cols[iDefJersey] ?? '', cols[iDefName] ?? '', cols[iDefTeam])

    // An empty attacker_id means "this defender was never annotated in this
    // bucket" — which is NOT the same as GUARD_NONE ("annotated as marking no
    // one"). Collapsing the two would turn missing work into a real answer.
    const attRaw = (cols[iAttId] ?? '').trim()
    if (!attRaw) continue
    const att: AttackerId = attRaw === 'GUARD_NONE' ? 'GUARD_NONE' : parseInt(attRaw)
    if (typeof att === 'number' && isNaN(att)) continue
    if (typeof att === 'number') {
      notePlayer(att, cols[iAttJersey] ?? '', cols[iAttName] ?? '')
    }

    if (!b.assignments.has(defId)) {
      b.assignments.set(defId, att)
      if (iConf !== -1) {
        const c = parseInt(cols[iConf])
        if (c === 1 || c === 2 || c === 3) b.confidence.set(defId, c)
      }
    }
  }

  return {
    annotator, gameId, quarter,
    sourceFile: filename,
    sourceFormat: 'csv',
    players, buckets,
  }
}
