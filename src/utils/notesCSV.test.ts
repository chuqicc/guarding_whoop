import { describe, it, expect } from 'vitest'
import { buildNotesCSV, fmtLocalTimestamp } from './export'
import type { AnnotationNote, QuarterMeta, Player } from '../store/useStore'

const TEAM_A = 100, TEAM_B = 200
const players: Player[] = [
  { id: 1, name: 'Kevin Garnett', jersey: '21', teamId: TEAM_A, teamAbbr: 'MIN' },
  { id: 6, name: 'Kobe Bryant', jersey: '24', teamId: TEAM_B, teamAbbr: 'LAL' },
]
const playerDict = Object.fromEntries(players.map(p => [p.id, p]))
const meta: QuarterMeta = {
  filename: '0021500017_Q3', gameId: '0021500017', quarter: 3,
  teamA: { teamId: TEAM_A, abbr: 'MIN', players: [players[0]] },
  teamB: { teamId: TEAM_B, abbr: 'LAL', players: [players[1]] },
  defendingTeamId: TEAM_A, totalFrames: 100, startClock: 720, endClock: 0,
}

const note = (o: Partial<AnnotationNote> & { bucket: number }): AnnotationNote => ({
  id: `n${o.bucket}`, text: 'why', createdAt: '2026-07-25T21:44:27.025Z', ...o,
})

const parse = (csv: string) => {
  const [head, ...rest] = csv.split('\n')
  const cols = head.split(',')
  return rest.map(line => {
    // Fields here never contain a comma inside quotes except `text`, which the
    // tests keep comma-free, so a plain split is enough.
    const cells = line.split(',')
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]))
  })
}

describe('notes CSV — the game clock is readable', () => {
  it('leads with mm:ss.s, and keeps the raw bucket for joining', () => {
    const rows = parse(buildNotesCSV([note({ bucket: 105.5 })], meta, playerDict))
    expect(rows[0].clock).toBe('1:45.5')
    expect(rows[0].bucket).toBe('105.5')
  })

  it('pads the seconds so the column lines up', () => {
    const rows = parse(buildNotesCSV([note({ bucket: 604 }), note({ bucket: 8.5 })], meta, playerDict))
    expect(rows.map(r => r.clock)).toEqual(['10:04.0', '0:08.5'])
  })

  it('handles the top of the quarter', () => {
    const rows = parse(buildNotesCSV([note({ bucket: 720 })], meta, playerDict))
    expect(rows[0].clock).toBe('12:00.0')
  })
})

describe('notes CSV — ordering and content', () => {
  it('sorts chronologically, not by when the note was typed', () => {
    const notes = [note({ bucket: 105.5 }), note({ bucket: 604 }), note({ bucket: 300 })]
    const rows = parse(buildNotesCSV(notes, meta, playerDict))
    expect(rows.map(r => r.clock)).toEqual(['10:04.0', '5:00.0', '1:45.5'])
  })

  it('does not mutate the caller\'s array while sorting', () => {
    const notes = [note({ bucket: 100 }), note({ bucket: 600 })]
    buildNotesCSV(notes, meta, playerDict)
    expect(notes.map(n => n.bucket)).toEqual([100, 600])
  })

  it('names the defender when the note is attached to one', () => {
    const rows = parse(buildNotesCSV([note({ bucket: 100, defenderId: 1 })], meta, playerDict))
    expect(rows[0].defender_jersey).toBe('21')
    expect(rows[0].defender_name).toBe('Kevin Garnett')
  })

  it('leaves the defender blank when there is none', () => {
    const rows = parse(buildNotesCSV([note({ bucket: 100 })], meta, playerDict))
    expect(rows[0].defender_jersey).toBe('')
    expect(rows[0].defender_name).toBe('')
  })

  it('emits only a header when there are no notes', () => {
    const csv = buildNotesCSV([], meta, playerDict)
    expect(csv.split('\n')).toHaveLength(1)
    expect(csv).toContain('clock')
  })
})

describe('fmtLocalTimestamp', () => {
  it('reads as wall-clock time and carries the offset', () => {
    const out = fmtLocalTimestamp('2026-07-25T21:44:27.025Z')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/)
  })

  it('names the same instant as the ISO string it came from', () => {
    const iso = '2026-07-25T21:44:27.025Z'
    const out = fmtLocalTimestamp(iso)
    const [date, time, offset] = out.split(' ')
    // Reassembling into an ISO-with-offset must land on the original instant.
    expect(new Date(`${date}T${time}${offset}`).getTime())
      .toBe(new Date(iso).getTime() - 25)   // the millis are dropped
  })

  it('passes an unparseable value through rather than printing Invalid Date', () => {
    expect(fmtLocalTimestamp('not a date')).toBe('not a date')
  })
})
