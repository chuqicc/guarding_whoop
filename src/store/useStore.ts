import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { parsePlayerDict } from '../utils/parseCSV'
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
  quarterMeta: QuarterMeta | null

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

function fileKey(prefix: string, quarterMeta: QuarterMeta | null): string | null {
  return quarterMeta ? `${prefix}_quarter_${quarterMeta.filename}` : null
}

// Single persistence entry point. Every mutator routes through this, so there is
// no code path that can mutate state and forget to write it back.
function persist(prefix: string, quarterMeta: QuarterMeta | null, value: unknown): void {
  const key = fileKey(prefix, quarterMeta)
  if (key) localStorage.setItem(key, JSON.stringify(value))
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
  quarterMeta: null,
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
    set({ frames, quarterMeta, playerDict, currentFrame: 0, isPlaying: false, cellAnnotations: [], deadTimeBuckets, shotBuckets, reboundBuckets, memoryBarrierFrames, pendingRestore, notes, annotationSeconds })
  },

  setCurrentFrame:  (n) => set({ currentFrame: n }),
  setPlaying:       (v) => set({ isPlaying: v }),
  setVideoPlaying:  (v) => set({ isVideoPlaying: v }),
  setSpeed:         (v) => set({ playbackSpeed: v }),

  toggleDefendingTeam: () => {
    const { quarterMeta, currentFrame, memoryBarrierFrames } = get()
    // Swapping possession wipes the auto-fill memory: record a barrier at the
    // current frame so assignments from before the swap are never carried forward.
    const barriers = memoryBarrierFrames.includes(currentFrame)
      ? memoryBarrierFrames
      : [...memoryBarrierFrames, currentFrame].sort((a, b) => a - b)
    if (quarterMeta) {
      const newDefId = quarterMeta.defendingTeamId === quarterMeta.teamA.teamId
        ? quarterMeta.teamB.teamId : quarterMeta.teamA.teamId
      set({ quarterMeta: { ...quarterMeta, defendingTeamId: newDefId }, memoryBarrierFrames: barriers })
    }
    persist('membarrier', get().quarterMeta, get().memoryBarrierFrames)
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
    persist('annotation', get().quarterMeta, get().cellAnnotations)
  },

  setCellConfidence: (defenderId, bucket, confidence) => {
    set(s => ({
      cellAnnotations: s.cellAnnotations.map(c =>
        c.defenderId === defenderId && c.shotClockBucket === bucket
          ? { ...c, confidence }
          : c
      ),
    }))
    persist('annotation', get().quarterMeta, get().cellAnnotations)
  },

  removeCellAnnotation: (id) => {
    set(s => ({ cellAnnotations: s.cellAnnotations.filter(c => c.id !== id) }))
    persist('annotation', get().quarterMeta, get().cellAnnotations)
  },

  setCellAnnotations: (anns) => {
    set({ cellAnnotations: anns })
    persist('annotation', get().quarterMeta, get().cellAnnotations)
  },

  clearBucketAnnotations: (bucket) => {
    set(s => ({ cellAnnotations: s.cellAnnotations.filter(c => c.shotClockBucket !== bucket) }))
    persist('annotation', get().quarterMeta, get().cellAnnotations)
  },

  toggleDeadTimeBucket: (bucket) => {
    set(s => {
      const next = s.deadTimeBuckets.includes(bucket)
        ? s.deadTimeBuckets.filter(b => b !== bucket)
        : [...s.deadTimeBuckets, bucket]
      return { deadTimeBuckets: next }
    })
    persist('deadtime', get().quarterMeta, get().deadTimeBuckets)
  },

  toggleShotBucket: (bucket) => {
    set(s => ({
      shotBuckets: s.shotBuckets.includes(bucket)
        ? s.shotBuckets.filter(b => b !== bucket)
        : [...s.shotBuckets, bucket],
    }))
    persist('shot', get().quarterMeta, get().shotBuckets)
  },

  toggleReboundBucket: (bucket) => {
    set(s => ({
      reboundBuckets: s.reboundBuckets.includes(bucket)
        ? s.reboundBuckets.filter(b => b !== bucket)
        : [...s.reboundBuckets, bucket],
    }))
    persist('rebound', get().quarterMeta, get().reboundBuckets)
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
    const qm = get().quarterMeta
    persist('annotation', qm, get().cellAnnotations)
    persist('deadtime',   qm, get().deadTimeBuckets)
    persist('shot',       qm, get().shotBuckets)
    persist('rebound',    qm, get().reboundBuckets)
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
    persist('notes', get().quarterMeta, get().notes)
  },

  removeNote: (id) => {
    set(s => ({ notes: s.notes.filter(n => n.id !== id) }))
    persist('notes', get().quarterMeta, get().notes)
  },

  setAnnotatorName: (name) => {
    set({ annotatorName: name })
    localStorage.setItem('annotatorName', name)
  },

  incrementAnnotationTime: (delta) => {
    set(s => ({ annotationSeconds: s.annotationSeconds + delta }))
    persist('anntime', get().quarterMeta, get().annotationSeconds)
  },
}))
