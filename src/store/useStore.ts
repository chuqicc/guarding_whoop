import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { parsePlayerDict, parsePossession } from '../utils/parseCSV'
import { parseQuarterJSON } from '../utils/parseQuarterJSON'
import { detectGaps } from '../utils/videoSync'

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

export interface SyncPoint {
  id: string
  frame: number       // tracking frameIndex
  videoTime: number   // video.currentTime at this frame
}

export interface GapInfo {
  frameIndex: number   // frame AFTER which the dead-ball gap begins
  clockJump: number    // seconds of clock time skipped
}

// attackerId: player id number, or 'GUARD_NONE' for "guarding no one"
export type AttackerId = number | 'GUARD_NONE'

// Cell-based annotation: one attacker assignment per shot-clock second bucket
export interface CellAnnotation {
  id: string
  defenderId: number
  attackerId: AttackerId
  shotClockBucket: number   // integer = Math.floor(shot_clock) or Math.floor(quarterClock)
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

  // ── Restore ──
  pendingRestore: CellAnnotation[] | null

  // ── Video ──
  videoUrl: string | null
  syncPoints: SyncPoint[]    // multi-keyframe sync (replaces single videoOffset)
  gapFrames: GapInfo[]       // auto-detected dead-ball gap positions

  // ── Court display ──
  flipX: boolean
  flipY: boolean

  // ── Theme ──
  theme: 'dark' | 'light'

  // ── Court click-to-assign signal (consumed by RosterPanel to sync defOrder) ──
  lastCourtAssignment: { defId: number; attId: number } | null

  // ── Actions ──
  loadPlayerDict: (csvText: string) => void
  loadPossession: (csvText: string, filename: string) => void
  loadQuarter: (jsonText: string, filename: string) => void
  toggleDeadTimeBucket: (bucket: number) => void
  setCurrentFrame:   (n: number) => void
  setPlaying:        (v: boolean) => void
  setVideoPlaying:   (v: boolean) => void
  setSpeed:          (v: number) => void
  toggleDefendingTeam: () => void
  setCellAnnotation: (defenderId: number, attackerId: AttackerId, bucket: number) => void
  removeCellAnnotation: (id: string) => void
  setCellAnnotations: (anns: CellAnnotation[]) => void  // for import / restore
  clearBucketAnnotations: (bucket: number) => void
  dismissRestore: () => void
  setVideoUrl: (url: string | null) => void
  addSyncPoint:    (frame: number, videoTime: number) => void
  removeSyncPoint: (id: string) => void
  clearSyncPoints: () => void
  toggleFlipX: () => void
  toggleFlipY: () => void
  toggleTheme: () => void
  signalCourtAssignment: (defId: number, attId: number) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function syncKey(possession: PossessionMeta | null, quarterMeta: QuarterMeta | null): string | null {
  if (possession)  return `syncpoints_${possession.filename}`
  if (quarterMeta) return `syncpoints_quarter_${quarterMeta.filename}`
  return null
}

function loadSyncPoints(key: string | null): SyncPoint[] {
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as SyncPoint[]
  } catch { /* ignore */ }
  return []
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
  pendingRestore: null,
  videoUrl: null,
  syncPoints: [],
  gapFrames: [],
  flipX: false,
  flipY: false,
  theme: 'dark' as const,
  lastCourtAssignment: null,

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
    const gapFrames = detectGaps(frames)
    const spKey = `syncpoints_${possession.filename}`
    const syncPoints = loadSyncPoints(spKey)
    set({ frames, possession, quarterMeta: null, mode: 'possession', currentFrame: 0, isPlaying: false, cellAnnotations: [], deadTimeBuckets, gapFrames, syncPoints, pendingRestore })
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
    const gapFrames = detectGaps(frames)
    const spKey = `syncpoints_quarter_${quarterMeta.filename}`
    const syncPoints = loadSyncPoints(spKey)
    set({ frames, quarterMeta, possession: null, playerDict, mode: 'quarter', currentFrame: 0, isPlaying: false, cellAnnotations: [], deadTimeBuckets, gapFrames, syncPoints, pendingRestore })
  },

  setCurrentFrame:  (n) => set({ currentFrame: n }),
  setPlaying:       (v) => set({ isPlaying: v }),
  setVideoPlaying:  (v) => set({ isVideoPlaying: v }),
  setSpeed:         (v) => set({ playbackSpeed: v }),

  toggleDefendingTeam: () => {
    const { possession, quarterMeta } = get()
    if (possession) {
      const newDefId = possession.defendingTeamId === possession.teamA.teamId
        ? possession.teamB.teamId : possession.teamA.teamId
      set({ possession: { ...possession, defendingTeamId: newDefId } })
    } else if (quarterMeta) {
      const newDefId = quarterMeta.defendingTeamId === quarterMeta.teamA.teamId
        ? quarterMeta.teamB.teamId : quarterMeta.teamA.teamId
      set({ quarterMeta: { ...quarterMeta, defendingTeamId: newDefId } })
    }
  },

  setCellAnnotation: (defenderId, attackerId, bucket) => {
    set(s => {
      const filtered = s.cellAnnotations.filter(
        c => !(c.defenderId === defenderId && c.shotClockBucket === bucket)
      )
      const newAnn: CellAnnotation = { id: uuid(), defenderId, attackerId, shotClockBucket: bucket }
      return { cellAnnotations: [...filtered, newAnn] }
    })
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

  dismissRestore: () => set({ pendingRestore: null }),

  setVideoUrl: (url) => {
    const prev = get().videoUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    // Sync points are keyed to tracking data, not the video — keep them on video swap
    set({ videoUrl: url })
  },

  addSyncPoint: (frame, videoTime) => {
    set(s => {
      const sp: SyncPoint = { id: uuid(), frame, videoTime }
      const filtered = s.syncPoints.filter(p => p.frame !== frame)
      const next = [...filtered, sp].sort((a, b) => a.frame - b.frame)
      return { syncPoints: next }
    })
    const { possession, quarterMeta, syncPoints } = get()
    const key = syncKey(possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(syncPoints))
  },

  removeSyncPoint: (id) => {
    set(s => ({ syncPoints: s.syncPoints.filter(p => p.id !== id) }))
    const { possession, quarterMeta, syncPoints } = get()
    const key = syncKey(possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify(syncPoints))
  },

  clearSyncPoints: () => {
    set({ syncPoints: [] })
    const { possession, quarterMeta } = get()
    const key = syncKey(possession, quarterMeta)
    if (key) localStorage.setItem(key, JSON.stringify([]))
  },

  toggleFlipX: () => set(s => ({ flipX: !s.flipX })),
  toggleFlipY: () => set(s => ({ flipY: !s.flipY })),
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  signalCourtAssignment: (defId, attId) => set({ lastCourtAssignment: { defId, attId } }),
}))
