import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { resetHistory } from './undo'
import { buildAnnotationExport } from '../utils/export'

const TEAM_A = 100
const TEAM_B = 200
const FILE = 'seedtest'

const team = (teamid: number, abbr: string, ids: number[]) => ({
  name: abbr, teamid, abbreviation: abbr,
  players: ids.map(id => ({
    playerid: id, jersey: String(id), lastname: `L${id}`, firstname: `F${id}`, position: 'G',
  })),
})

interface BucketSpec { bucket: number; shotClock: number | null; gapMsBefore?: number; ballZ?: number }

/** Build a quarter JSON the parser accepts, one 0.5s bucket at a time. */
function quarterJSON(specs: BucketSpec[]): string {
  let t = 1_000_000
  const moments = []
  for (const s of specs) {
    if (s.gapMsBefore) t += s.gapMsBefore
    for (let i = 0; i < 12; i++) {
      moments.push([
        1, t, parseFloat((s.bucket + 0.4 - i * 0.03).toFixed(4)), s.shotClock, null,
        [
          [-1, -1, 47, 25, s.ballZ ?? 4],
          [TEAM_A, 1, 10, 10, 0],
          [TEAM_B, 6, 20, 20, 0],
        ],
      ])
      t += 40
    }
  }
  return JSON.stringify({
    gameid: 'G1', gamedate: '2015-11-01', quarter: 1,
    events: [{ eventId: '1', home: team(TEAM_A, 'AAA', [1]), visitor: team(TEAM_B, 'BBB', [6]), moments }],
  })
}

// 400.0 live, 399.5 + 399.0 held at 24 (dead), 398.5 live.
const JSON_TEXT = quarterJSON([
  { bucket: 400, shotClock: 10 },
  { bucket: 399.5, shotClock: 24 },
  { bucket: 399, shotClock: 24 },
  { bucket: 398.5, shotClock: 23.4 },
])

const load = () => useStore.getState().loadQuarter(JSON_TEXT, FILE)

beforeEach(() => {
  localStorage.clear()
  resetHistory()
  useStore.setState({
    deadTimeBuckets: [], deadSeedCount: 0, deadSeedBuckets: [], noShotClockBuckets: [],
    cellAnnotations: [],
  })
})

describe('dead-ball seeding on first load', () => {
  it('seeds from the tracking data and records that it did', () => {
    load()
    expect(useStore.getState().deadTimeBuckets).toEqual([399.5, 399])
    expect(useStore.getState().deadSeedCount).toBe(2)
    expect(localStorage.getItem(`deadseed_quarter_${FILE}`)).not.toBeNull()
    expect(JSON.parse(localStorage.getItem(`deadtime_quarter_${FILE}`)!)).toEqual([399.5, 399])
  })

  it('reports the buckets the shot clock cannot speak for', () => {
    useStore.getState().loadQuarter(
      quarterJSON([{ bucket: 400, shotClock: null }, { bucket: 399.5, shotClock: 10 }]),
      FILE,
    )
    expect(useStore.getState().noShotClockBuckets).toEqual([400])
  })
})

describe('seeding happens exactly once', () => {
  it('does not re-mark a bucket the annotator cleared', () => {
    // The whole point of the seed flag. Re-deriving on every load would put
    // this back, and nothing in the UI would say so.
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    expect(useStore.getState().deadTimeBuckets).toEqual([399])

    load()
    expect(useStore.getState().deadTimeBuckets).toEqual([399])
    expect(useStore.getState().deadSeedCount).toBe(0)
  })

  it('keeps a bucket the annotator added by hand', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(398.5)
    load()
    expect(useStore.getState().deadTimeBuckets).toContain(398.5)
  })

  it('leaves an already-seeded quarter with no dead marks empty', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    useStore.getState().toggleDeadTimeBucket(399)
    expect(useStore.getState().deadTimeBuckets).toEqual([])

    load()
    expect(useStore.getState().deadTimeBuckets).toEqual([])
  })
})

describe('seeded marks are ordinary annotation data', () => {
  it('clearing one is undoable', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    expect(useStore.getState().deadTimeBuckets).toEqual([399])

    useStore.getState().undo()
    expect(useStore.getState().deadTimeBuckets).toEqual(expect.arrayContaining([399.5, 399]))
  })
})

describe('explicit re-seed', () => {
  it('discards edits and derives again', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    useStore.getState().toggleDeadTimeBucket(398.5)
    expect(useStore.getState().deadTimeBuckets).toEqual(expect.arrayContaining([399, 398.5]))

    useStore.getState().reseedDeadBuckets()
    expect(useStore.getState().deadTimeBuckets).toEqual([399.5, 399])
  })

  it('is itself undoable — it throws away annotator work', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(398.5)
    useStore.getState().reseedDeadBuckets()
    useStore.getState().undo()
    expect(useStore.getState().deadTimeBuckets).toContain(398.5)
  })
})

describe('export provenance', () => {
  const rowsFor = () => {
    const st = useStore.getState()
    return buildAnnotationExport({
      annotations: st.cellAnnotations,
      deadTimeBuckets: st.deadTimeBuckets,
      deadSeedBuckets: st.deadSeedBuckets,
      shotBuckets: [], reboundBuckets: [],
      frames: st.frames, meta: st.quarterMeta!, playerDict: st.playerDict,
      annotatorName: 'A', annotationSeconds: 0, notes: [],
    }).buckets
  }
  const at = (b: number) => rowsFor().find(r => r.bucket === b)!

  it('labels seeded marks auto and hand-added ones manual', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(398.5)
    expect(at(399.5).dead_source).toBe('auto')
    expect(at(398.5).dead_source).toBe('manual')
  })

  it('flags a seeded bucket the annotator cleared', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    const row = at(399.5)
    expect(row.status).toBe('active')
    expect(row.auto_cleared).toBe(true)
  })

  it('says nothing about provenance when the seed is not supplied', () => {
    load()
    const rows = buildAnnotationExport({
      annotations: [], deadTimeBuckets: useStore.getState().deadTimeBuckets,
      shotBuckets: [], reboundBuckets: [],
      frames: useStore.getState().frames, meta: useStore.getState().quarterMeta!,
      playerDict: useStore.getState().playerDict,
      annotatorName: 'A', annotationSeconds: 0, notes: [],
    }).buckets
    expect(rows.every(r => r.dead_source === undefined && r.auto_cleared === undefined)).toBe(true)
  })

  it('remembers the seed across a reload, so provenance survives', () => {
    load()
    useStore.getState().toggleDeadTimeBucket(399.5)
    load()
    expect(useStore.getState().deadSeedBuckets).toEqual([399.5, 399])
    expect(at(399.5).auto_cleared).toBe(true)
  })
})
