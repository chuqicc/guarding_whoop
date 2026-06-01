import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { parsePlayerDict, parsePossession } from '../utils/parseCSV'

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

// attackerId: player id number, or 'GUARD_NONE' for "guarding no one"
export type AttackerId = number | 'GUARD_NONE'

// Cell-based annotation: one attacker assignment per shot-clock second bucket
export interface CellAnnotation {
  id: string
  defenderId: number
  attackerId: AttackerId
  shotClockBucket: number   // integer = Math.floor(shot_clock)
}

interface AppStore {
  // ── Data ──
  playerDict: Record<number, Player>
  frames: TrackingFrame[]
  possession: PossessionMeta | null

  // ── Playback ──
  currentFrame: number
  isPlaying: boolean
  playbackSpeed: number   // 0.5 | 1 | 2 | 4

  // ── Annotation ──
  cellAnnotations: CellAnnotation[]

  // ── Restore ──
  pendingRestore: CellAnnotation[] | null

  // ── Video ──
  videoUrl: string | null
  videoOffset: number

  // ── Court display ──
  flipX: boolean
  flipY: boolean

  // ── Theme ──
  theme: 'dark' | 'light'

  // ── Actions ──
  loadPlayerDict: (csvText: string) => void
  loadPossession: (csvText: string, filename: string) => void
  setCurrentFrame: (n: number) => void
  setPlaying: (v: boolean) => void
  setSpeed: (v: number) => void
  toggleDefendingTeam: () => void
  setCellAnnotation: (defenderId: number, attackerId: AttackerId, bucket: number) => void
  removeCellAnnotation: (id: string) => void
  setCellAnnotations: (anns: CellAnnotation[]) => void  // for import / restore
  dismissRestore: () => void
  setVideoUrl: (url: string | null) => void
  setVideoOffset: (v: number) => void
  toggleFlipX: () => void
  toggleFlipY: () => void
  toggleTheme: () => void
}

export const useStore = create<AppStore>((set, get) => ({
  playerDict: {},
  frames: [],
  possession: null,
  currentFrame: 0,
  isPlaying: false,
  playbackSpeed: 1,
  cellAnnotations: [],
  pendingRestore: null,
  videoUrl: null,
  videoOffset: 0,
  flipX: false,
  flipY: false,
  theme: 'dark' as const,

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
        // Only restore if it looks like the new cell format (has shotClockBucket)
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].shotClockBucket !== undefined) {
          pendingRestore = parsed
        }
      } catch { /* ignore */ }
    }
    set({ frames, possession, currentFrame: 0, isPlaying: false, cellAnnotations: [], pendingRestore })
  },
  setCurrentFrame: (n) => set({ currentFrame: n }),
  setPlaying: (v) => set({ isPlaying: v }),
  setSpeed: (v) => set({ playbackSpeed: v }),
  toggleDefendingTeam: () => {
    const { possession } = get()
    if (!possession) return
    const newDefId = possession.defendingTeamId === possession.teamA.teamId
      ? possession.teamB.teamId
      : possession.teamA.teamId
    set({ possession: { ...possession, defendingTeamId: newDefId }, cellAnnotations: [] })
  },

  setCellAnnotation: (defenderId, attackerId, bucket) => {
    set(s => {
      const filtered = s.cellAnnotations.filter(
        c => !(c.defenderId === defenderId && c.shotClockBucket === bucket)
      )
      const newAnn: CellAnnotation = { id: uuid(), defenderId, attackerId, shotClockBucket: bucket }
      return { cellAnnotations: [...filtered, newAnn] }
    })
    const { possession, cellAnnotations } = get()
    if (possession) localStorage.setItem(`annotation_${possession.filename}`, JSON.stringify(cellAnnotations))
  },

  removeCellAnnotation: (id) => {
    set(s => ({ cellAnnotations: s.cellAnnotations.filter(c => c.id !== id) }))
    const { possession, cellAnnotations } = get()
    if (possession) localStorage.setItem(`annotation_${possession.filename}`, JSON.stringify(cellAnnotations))
  },

  setCellAnnotations: (anns) => set({ cellAnnotations: anns }),
  dismissRestore: () => set({ pendingRestore: null }),
  setVideoUrl: (url) => {
    const prev = get().videoUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({ videoUrl: url, videoOffset: 0 })
  },
  setVideoOffset: (v) => set({ videoOffset: v }),
  toggleFlipX: () => set(s => ({ flipX: !s.flipX })),
  toggleFlipY: () => set(s => ({ flipY: !s.flipY })),
  toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
}))
