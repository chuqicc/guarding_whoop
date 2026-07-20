import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { parsePlayerDict, parsePossession } from '../utils/parseCSV'
import { parseQuarterJSON } from '../utils/parseQuarterJSON'

// ── Types ──────────────────────────────────────────────────────────────────

export interface Player {
  id: number
  name: string
  jersey: string       // always a clean integer string e.g. "23", never "23.0"
  teamId: number
  teamAbbr: string
}

export interface TrackingFrame {
  frameIndex: number
  momentId?: number      // Unix-ms timestamp from SportVU JSON (absent for CSV possessions)
  quarterClock: number
  shotClock: number | null
  ballX: number
  ballY: number
  ballZ: number
  players: Array<{ id: number; teamId: number; x: number; y: number }>
}

export interface PossessionMeta {
  filename: string          // original CSV filename without extension
  gameId: string
  quarter: number
  possessionIndex: number
  teamA: { teamId: number; abbr: string; players: Player[] }  // slots 1-5
  teamB: { teamId: number; abbr: string; players: Player[] }  // slots 6-10
  defendingTeamId: number   // user can toggle which team defends
  totalFrames: number
  startClock: number        // quarter_clock of first frame (higher value)
  endClock: number          // quarter_clock of last frame (lower value)
}

export interface QuarterMeta {
  filename: string
  gameId: string
  quarter: number
  teamA: { teamId: number; abbr: string; players: Player[] }
  teamB: { teamId: number; abbr: string; players: Player[] }
  defendingTeamId: number
  totalFrames: number
  startClock: number
  endClock: number
}

// attackerId: player id number, or 'GUARD_NONE' for "guarding no one"
export type AttackerId = number | 'GUARD_NONE'

// Cell-based annotation: one attacker assignment per shot-clock second bucket
export interface CellAnnotation {
  id: string
  defenderId: number
  attackerId: AttackerId
  shotClockBucket: number   // integer = Math.floor(shot_clock) or Math.floor(quarterClock)
  confidence?: 1 | 2 | 3    // 3 = certain (default), 2 = fairly sure, 1 = unsure
}

// Free-text observation tied to a moment in the timeline (protocol §11 "Notes")
export interface AnnotationNote {
  id: string
  bucket: number
  defenderId?: number
  text: string
  createdAt: string
}

interface AppStore {
  // ── Data ──
  playerDict: Record<number, Player>
  frames: TrackingFrame[]
  possession: PossessionMeta | null
  quarterMeta: QuarterMeta | null
  mode: 'possession' | 'quarter' | null

  // ── Playback ──
  currentFrame: number
  isPlaying: boolean        // tracking animation is running
  isVideoPlaying: boolean   // video is playing (independent channel)
  playbackSpeed: number     // 0.5 | 1 | 2 | 4

  // ── Annotation ──
  cellAnnotations: CellAnnotation[]
  deadTimeBuckets: number[]        // bucket keys marked as dead time (no live play)
  shotBuckets: number[]            // bucket keys marked with a shot attempt (出手)
  reboundBuckets: number[]         // bucket keys marked with a rebound (篮板)

  // ── Auto-fill memory (carry previous bucket's assignments forward) ──
  autoFillMemory: boolean          // toggleable; false = never auto-fill
  memoryBarrierFrames: number[]    // frame indices where defense swapped; auto-fill never crosses these

  // ── Restore ──
  pendingRestore: CellAnnotation[] | null

  // ── Video ──
  videoUrl: string | null

  // ── Court display ──
  flipX: boolean
  flipY: boolean

  // ── Theme ──
  theme: 'dark' | 'light'

  // ── Annotation protocol metadata ──
  notes: AnnotationNote[]
  annotatorName: string
  annotationSeconds: number

  // ── Actions ──
  loadPlayerDict: (csvText: string) => void
  loadPossession: (csvText: string, filename: string) => void
  loadQuarter: (jsonText: string, filename: string) => void
  toggleDeadTimeBucket: (bucket: number) => void
  toggleShotBucket: (bucket: number) => void
  toggleReboundBucket: (bucket: number) => void
  toggleAutoFillMemory: () => void
  restoreImported: (data: { annotations: CellAnnotation[]; deadTimeBuckets?: number[]; shotBuckets?: number[]; reboundBuckets?: number[] }) => void
  setCurrentFrame:   (n: number) => void
  setPlaying:        (v: boolean) => void
  setVideoPlaying:   (v: boolean) => void
  setSpeed:          (v: number) => void
  toggleDefendingTeam: () => void
  setCellAnnotation: (defenderId: number, attackerId: AttackerId, bucket: number, confidence?: 1 | 2 | 3) => void
  setCellConfidence: (defenderId: number, bucket: number, confidence: 1 | 2 | 3) => void
  removeCellAnnotation: (id: string) => void
  setCellAnnotations: (anns: CellAnnotation[]) => void  // for import / restore
  clearBucketAnnotations: (bucket: number) => void
  dismissRestore: () => void
  setVideoUrl: (url: string | null) => void
  toggleFlipX: () => void
  toggleFlipY: () => void
  toggleTheme: () => void
  addNote: (bucket: number, text: string, defenderId?: number) => void
  removeNote: (id: string) => void
  setAnnotatorName: (name: string) => void
  incrementAnnotationTime: (delta: number) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fileKey(prefix: string, possession: PossessionMeta | null, quarterMeta: QuarterMeta | null): string | null {
  if (possession)  return `${prefix}_${possession.filename}`
  if (quarterMeta) return `${prefix}_quarter_${quarterMeta.filename}`
  return null
}

function loadNotes(key: string | null): AnnotationNote[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as AnnotationNote[]
  } catch { /* ignore */ }
  return []
}

function loadNumberArray(key: string | null): number[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter(n => typeof n === 'number')
  } catch { /* ignore */ }
  return []
}

function loadNumber(key: string | null): number {
  if (!key) return 0
  const raw = localStorage.getItem(key)
  const n = raw ? parseFloat(raw) : 0
  return isNaN(n) ? 0 : n
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useStore = create<AppStore>((set, get) => ({
  playerDict: {},
  frames: [],
  possession: null,
  quarterMeta: null,
  mode: null,
  currentFrame: 0,
  isPlaying: false,
  isVideoPlaying: false,
  playbackSpeed: 1,
  cellAnnotations: [],
  deadTimeBuckets: [],
  shotBuckets: [],
  reboundBuckets: [],
  autoFillMemory: localStorage.getItem('autoFillMemory') !== 'off',
  memoryBarrierFrames: [],
  pendingRestore: null,
  videoUrl: null,
  flipX: false,
  flipY: false,
  theme: 'dark' as const,
  notes: [],
  annotatorName: localStorage.getItem('annotatorName') ?? '',
  annotationSeconds: 0,

  loadPlayerDict: (csvText) => {
    const dict = parsePlayerDict(csvText)
    set({ playerDict: dict })
  },

  loadPossession: (csvText, filename) => {
    const { playerDict } = get()
    const { frames, possession } = parsePossession(csvText, filename, playerDict)
    const key = `annotation_${possession.filename}`
    let pendingRestore: CellAnnotation[] | null = null
    const saved = localStorage.getItem(key)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as CellAnnotation[]
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].shotClockBucket !== undefined) {
          pendingRestore = parsed
        }
      } catch { /* ignore */ }
    }
    const deadSaved = localStorage.getItem(`deadtime_${possession.filename}`)
    const deadTimeBuckets: number[] = deadSaved ? JSON.parse(deadSaved) : []
    const shotBuckets    = loadNumberArray(`shot_${possession.filename}`)
    const reboundBuckets = loadNumberArray(`rebound_${possession.filename}`)
    const memoryBarrierFrames = loadNumberArray(`membarrier_${possession.filename}`)
    const notes = loadNotes(`notes_${possession.filename}`)
    const annotationSeconds = loadNumber(`anntime_${possession.filename}`)
    set({ frames, possession, quarterMeta: null, mode: 'possession', currentFrame: 0, isPlaying: false, cellAnnotations: [], deadTimeBuckets, shotBuckets, reboundBuckets, memoryBarrierFrames, pendingRestore, notes, annotationSeconds })
  },

  loadQuarter: (jsonText, filename) => {
    const { frames, quarterMeta, playerDict } = parseQuarterJSON(jsonText, filename)
    const key = `annotation_quarter_${quarterMeta.filename}`
    let pendingRestore: CellAnnotation[] | null = null
    const saved = localStorage.getItem(key)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as CellAnnotation[]
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].shotClockBucket !== undefined) {
          pendingRestore = parsed
        }
      } catch { /* ignore */ }
    }
    const deadSaved = localStorage.getItem(`deadtime_quarter_${quarterMeta.filename}`)
    const deadTimeBuckets: number[] = deadSaved ? JSON.parse(deadSaved) : []
    const shotBuckets    = loadNumberArray(`shot_quarter_${quarterMeta.filename}`)
    const reboundBuckets = loadNumberArray(`rebound_quarter_${quarterMeta.filename}`)
    const memoryBarrierFrames = loadNumberArray(`membarrier_quarter_${quarterMeta.filename}`)
    const notes = loadNotes(`notes_quarter_${quarterMeta.filename}`)
    const annotationSeconds = loadNumber(`anntime_quarter_${quarterMeta.filename}`)
    set({ frames, quarterMeta, possession: null, playerDict, mode: 'quarter', currentFrame: 0, isPlaying: false, cellAnnotations: [], deadTimeBuckets, shotBuckets, reboundBuckets, memoryBarrierFrames, pendingRestore, notes, annotationSeconds })
  },

  setCurrentFrame:  (n) => set({ currentFrame: n }),
  setPlaying:       (v) => set({ isPlaying: v }),
  setVideoPlaying:  (v) => set({ isVideoPlaying: v }),
  setSpeed:         (v) => set({ playbackSpeed: v }),

  toggleDefendingTeam: () => {
    const { possession, quarterMeta, currentFrame, memoryBarrierFrames } = get()
    // Swapping possession wipes the auto-fill memory: record a barrier at the
    // current frame so assignments from before the swap are never carried forward.
    const barriers = memoryBarrierFrames.includes(currentFrame)
      ? memoryBarrierFrames
      : [...memoryBarrierFrames, currentFrame].sort((a, b) => a - b)
    if (possession) {
      const newDefId = possession.defendingTeamId === possession.teamA.teamId
        ? possession.teamB.teamId : possession.teamA.teamId
      set({ possession: { ...possession, defendingTeamId: newDefId }, memoryBarrierFrames: barriers })
    } else if (quarterMeta) {
      const newDefId = quarterMeta.defendingTeamId === quarterMeta.teamA.teamId
        ? quarterMeta.teamB.teamId : quarterMeta.teamA.teamId
      set({ quarterMeta: { ...quarterMeta, defendingTeamId: newDefId }, memoryBarrierFrames: barriers })
    }
    const key = fileKey('membarrier', get().possession, get().quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(get().memoryBarrierFrames))
  },

  setCellAnnotation: (defenderId, attackerId, bucket, confidence) => {
    // Dead-time buckets never accept assignments (hard rule, feature #1)
    if (get().deadTimeBuckets.includes(bucket)) return
    set(s => {
      const existing = s.cellAnnotations.find(
        c => c.defenderId === defenderId && c.shotClockBucket === bucket
      )
      const filtered = s.cellAnnotations.filter(
        c => !(c.defenderId === defenderId && c.shotClockBucket === bucket)
      )
      const newAnn: CellAnnotation = {
        id: uuid(), defenderId, attackerId, shotClockBucket: bucket,
        confidence: confidence ?? existing?.confidence,
      }
      return { cellAnnotations: [...filtered, newAnn] }
    })
    const { possession, quarterMeta, cellAnnotations } = get()
    const lsKey = possession
      ? `annotation_${possession.filename}`
      : quarterMeta ? `annotation_quarter_${quarterMeta.filename}` : null
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(cellAnnotations))
  },

  setCellConfidence: (defenderId, bucket, confidence) => {
    set(s => ({
      cellAnnotations: s.cellAnnotations.map(c =>
        c.defenderId === defenderId && c.shotClockBucket === bucket
          ? { ...c, confidence }
          : c
      ),
    }))
    const { possession, quarterMeta, cellAnnotations } = get()
    const lsKey = possession
      ? `annotation_${possession.filename}`
      : quarterMeta ? `annotation_quarter_${quarterMeta.filename}` : null
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(cellAnnotations))
  },

  removeCellAnnotation: (id) => {
    set(s => ({ cellAnnotations: s.cellAnnotations.filter(c => c.id !== id) }))
    const { possession, quarterMeta, cellAnnotations } = get()
    const lsKey = possession
      ? `annotation_${possession.filename}`
      : quarterMeta ? `annotation_quarter_${quarterMeta.filename}` : null
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(cellAnnotations))
  },

  setCellAnnotations: (anns) => set({ cellAnnotations: anns }),

  clearBucketAnnotations: (bucket) => {
    set(s => ({ cellAnnotations: s.cellAnnotations.filter(c => c.shotClockBucket !== bucket) }))
    const { possession, quarterMeta, cellAnnotations } = get()
    const lsKey = possession
      ? `annotation_${possession.filename}`
      : quarterMeta ? `annotation_quarter_${quarterMeta.filename}` : null
    if (lsKey) localStorage.setItem(lsKey, JSON.stringify(cellAnnotations))
  },

  toggleDeadTimeBucket: (bucket) => {
    set(s => {
      const next = s.deadTimeBuckets.includes(bucket)
        ? s.deadTimeBuckets.filter(b => b !== bucket)
        : [...s.deadTimeBuckets, bucket]
      return { deadTimeBuckets: next }
    })
    const { possession, quarterMeta, deadTimeBuckets } = get()
    const key = possession
      ? `deadtime_${possession.filename}`
      : quarterMeta ? `deadtime_quarter_${quarterMeta.filename}` : null
    if (key) localStorage.setItem(key, JSON.stringify(deadTimeBuckets))
  },

  toggleShotBucket: (bucket) => {
    set(s => ({
      shotBuckets: s.shotBuckets.includes(bucket)
        ? s.shotBuckets.filter(b => b !== bucket)
        : [...s.shotBuckets, bucket],
    }))
    const { possession, quarterMeta, shotBuckets } = get()
    const key = fileKey('shot', possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(shotBuckets))
  },

  toggleReboundBucket: (bucket) => {
    set(s => ({
      reboundBuckets: s.reboundBuckets.includes(bucket)
        ? s.reboundBuckets.filter(b => b !== bucket)
        : [...s.reboundBuckets, bucket],
    }))
    const { possession, quarterMeta, reboundBuckets } = get()
    const key = fileKey('rebound', possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(reboundBuckets))
  },

  toggleAutoFillMemory: () => {
    const next = !get().autoFillMemory
    set({ autoFillMemory: next })
    localStorage.setItem('autoFillMemory', next ? 'on' : 'off')
  },

  restoreImported: ({ annotations, deadTimeBuckets, shotBuckets, reboundBuckets }) => {
    set(s => ({
      cellAnnotations: annotations,
      deadTimeBuckets: deadTimeBuckets ?? s.deadTimeBuckets,
      shotBuckets:     shotBuckets     ?? s.shotBuckets,
      reboundBuckets:  reboundBuckets  ?? s.reboundBuckets,
    }))
    const { possession, quarterMeta } = get()
    const save = (prefix: string, value: unknown) => {
      const key = fileKey(prefix, possession, quarterMeta)
      if (key) localStorage.setItem(key, JSON.stringify(value))
    }
    save('annotation', get().cellAnnotations)
    save('deadtime',   get().deadTimeBuckets)
    save('shot',       get().shotBuckets)
    save('rebound',    get().reboundBuckets)
  },

  dismissRestore: () => set({ pendingRestore: null }),

  setVideoUrl: (url) => {
    const prev = get().videoUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({ videoUrl: url })
  },

  toggleFlipX: () => set(s => ({ flipX: !s.flipX })),
  toggleFlipY: () => set(s => ({ flipY: !s.flipY })),
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  addNote: (bucket, text, defenderId) => {
    set(s => ({
      notes: [...s.notes, { id: uuid(), bucket, defenderId, text, createdAt: new Date().toISOString() }],
    }))
    const { possession, quarterMeta, notes } = get()
    const key = fileKey('notes', possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(notes))
  },

  removeNote: (id) => {
    set(s => ({ notes: s.notes.filter(n => n.id !== id) }))
    const { possession, quarterMeta, notes } = get()
    const key = fileKey('notes', possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(notes))
  },

  setAnnotatorName: (name) => {
    set({ annotatorName: name })
    localStorage.setItem('annotatorName', name)
  },

  incrementAnnotationTime: (delta) => {
    set(s => ({ annotationSeconds: s.annotationSeconds + delta }))
    const { possession, quarterMeta, annotationSeconds } = get()
    const key = fileKey('anntime', possession, quarterMeta)
    if (key) localStorage.setItem(key, String(annotationSeconds))
  },
}))
