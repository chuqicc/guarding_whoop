import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { resetHistory, getHistoryState } from './undo'
import type { QuarterMeta, Player } from './useStore'

const TEAM_A = 100
const TEAM_B = 200
const playersA: Player[] = [
  { id: 1, name: 'Def One', jersey: '4', teamId: TEAM_A, teamAbbr: 'AAA' },
  { id: 2, name: 'Def Two', jersey: '5', teamId: TEAM_A, teamAbbr: 'AAA' },
]
const playersB: Player[] = [{ id: 6, name: 'Att One', jersey: '10', teamId: TEAM_B, teamAbbr: 'BBB' }]

const meta: QuarterMeta = {
  filename: 'undo_test', gameId: 'G1', quarter: 1,
  teamA: { teamId: TEAM_A, abbr: 'AAA', players: playersA },
  teamB: { teamId: TEAM_B, abbr: 'BBB', players: playersB },
  defendingTeamId: TEAM_A, totalFrames: 10, startClock: 400, endClock: 395,
}

const anns = () => useStore.getState().cellAnnotations
const cellFor = (def: number, bucket: number) =>
  anns().find(c => c.defenderId === def && c.shotClockBucket === bucket)

beforeEach(() => {
  localStorage.clear()
  resetHistory()
  useStore.setState({
    quarterMeta: { ...meta },
    cellAnnotations: [], deadTimeBuckets: [], shotBuckets: [], reboundBuckets: [],
    memoryBarrierFrames: [], currentFrame: 0, autoFillMemory: true,
  })
})

describe('undo of explicit edits', () => {
  it('takes back one assignment per press', () => {
    const s = useStore.getState()
    s.setCellAnnotation(1, 6, 400)
    s.setCellAnnotation(2, 6, 400)
    expect(anns()).toHaveLength(2)

    useStore.getState().undo()
    expect(anns()).toHaveLength(1)
    expect(cellFor(1, 400)).toBeDefined()

    useStore.getState().undo()
    expect(anns()).toHaveLength(0)
  })

  it('redo re-applies what undo took back', () => {
    useStore.getState().setCellAnnotation(1, 6, 400)
    useStore.getState().undo()
    expect(anns()).toHaveLength(0)
    useStore.getState().redo()
    expect(cellFor(1, 400)?.attackerId).toBe(6)
  })

  it('restores a whole column cleared by the ✕ button in one step', () => {
    const s = useStore.getState()
    s.setCellAnnotation(1, 6, 400)
    s.setCellAnnotation(2, 6, 400)
    useStore.getState().clearBucketAnnotations(400)
    expect(anns()).toHaveLength(0)

    useStore.getState().undo()
    expect(anns()).toHaveLength(2)
  })

  it('undoes dead/shot/rebound toggles', () => {
    useStore.getState().toggleDeadTimeBucket(400)
    expect(useStore.getState().deadTimeBuckets).toEqual([400])
    useStore.getState().undo()
    expect(useStore.getState().deadTimeBuckets).toEqual([])
  })

  it('reports nothing to undo on an empty history', () => {
    expect(useStore.getState().undo()).toBeNull()
    expect(getHistoryState().canUndo).toBe(false)
  })

  it('a new edit clears the redo stack', () => {
    useStore.getState().setCellAnnotation(1, 6, 400)
    useStore.getState().undo()
    expect(getHistoryState().canRedo).toBe(true)
    useStore.getState().setCellAnnotation(2, 6, 400)
    expect(getHistoryState().canRedo).toBe(false)
  })
})

describe('undo skips machine-generated carry-forward', () => {
  it('one press reverts the auto-fills AND the edit beneath them', () => {
    // The real sequence: the annotator assigns a cell, then playback carries
    // that assignment forward across several buckets on its own.
    useStore.getState().setCellAnnotation(1, 6, 400)
    for (const b of [399.5, 399, 398.5]) {
      useStore.getState().setCellAnnotationsBatch(
        [{ defenderId: 1, attackerId: 6, bucket: b }], true,
      )
    }
    expect(anns()).toHaveLength(4)

    // A single Ctrl+Z must undo the thing the user did, not one auto-fill.
    useStore.getState().undo()
    expect(anns()).toHaveLength(0)
  })

  it('the undo label names the user action, not the auto-fill', () => {
    useStore.getState().setCellAnnotation(1, 6, 400)
    useStore.getState().setCellAnnotationsBatch(
      [{ defenderId: 1, attackerId: 6, bucket: 399.5 }], true,
    )
    expect(getHistoryState().undoLabel).toContain('assign')
    expect(useStore.getState().undo()).toContain('assign')
  })

  it('a batch of five carry-forward cells is one transaction, not five', () => {
    useStore.getState().setCellAnnotation(1, 6, 400)
    useStore.getState().setCellAnnotationsBatch([
      { defenderId: 1, attackerId: 6, bucket: 399.5 },
      { defenderId: 2, attackerId: 6, bucket: 399.5 },
    ], true)
    expect(anns()).toHaveLength(3)
    useStore.getState().undo()
    expect(anns()).toHaveLength(0)
  })

  it('never writes carry-forward into a dead bucket', () => {
    useStore.setState({ deadTimeBuckets: [399.5] })
    useStore.getState().setCellAnnotationsBatch(
      [{ defenderId: 1, attackerId: 6, bucket: 399.5 }], true,
    )
    expect(anns()).toHaveLength(0)
  })
})

describe('undo keeps localStorage in step with state', () => {
  it('persists the reverted value, not the one that was undone', () => {
    useStore.getState().setCellAnnotation(1, 6, 400)
    expect(JSON.parse(localStorage.getItem('annotation_quarter_undo_test')!)).toHaveLength(1)
    useStore.getState().undo()
    expect(JSON.parse(localStorage.getItem('annotation_quarter_undo_test')!)).toHaveLength(0)
  })
})
