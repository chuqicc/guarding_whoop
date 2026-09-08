import { describe, it, expect } from 'vitest'
import { parseCSVLine, splitCSVRecords, parseCSVTable } from './csv'

describe('parseCSVLine', () => {
  it('splits plain fields', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps a comma inside a quoted field — the "Smith, Jr." bug', () => {
    // Exported correctly by csvEscape, but the old naive split(',') shifted
    // every column after the name, so attacker_id read someone else's value.
    expect(parseCSVLine('1,"Smith, Jr.",7')).toEqual(['1', 'Smith, Jr.', '7'])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCSVLine('a,"say ""hi""",b')).toEqual(['a', 'say "hi"', 'b'])
  })

  it('preserves empty fields, including trailing ones', () => {
    expect(parseCSVLine('a,,c,')).toEqual(['a', '', 'c', ''])
  })

  it('handles a quoted empty field', () => {
    expect(parseCSVLine('a,"",c')).toEqual(['a', '', 'c'])
  })
})

describe('splitCSVRecords', () => {
  it('splits on LF', () => {
    expect(splitCSVRecords('a,b\nc,d')).toEqual(['a,b', 'c,d'])
  })

  it('strips CR on CRLF files — otherwise the last column keeps a \\r', () => {
    // The final column of the frame CSV is `annotator`, which the comparison
    // keys on; "Alice\r" would never match "Alice".
    const recs = splitCSVRecords('a,annotator\r\n1,Alice\r\n')
    expect(recs).toEqual(['a,annotator', '1,Alice'])
    expect(parseCSVLine(recs[1])[1]).toBe('Alice')
  })

  it('handles lone CR line endings', () => {
    expect(splitCSVRecords('a,b\rc,d')).toEqual(['a,b', 'c,d'])
  })

  it('keeps a newline that sits inside a quoted field', () => {
    const recs = splitCSVRecords('a,b\n"multi\nline",c')
    expect(recs).toHaveLength(2)
    expect(parseCSVLine(recs[1])).toEqual(['multi\nline', 'c'])
  })

  it('drops blank trailing lines', () => {
    expect(splitCSVRecords('a,b\n\n\n')).toEqual(['a,b'])
  })
})

describe('parseCSVTable', () => {
  it('returns trimmed headers and parsed rows', () => {
    const { headers, rows } = parseCSVTable('game_id, quarter\nG1,2\n')
    expect(headers).toEqual(['game_id', 'quarter'])
    expect(rows).toEqual([['G1', '2']])
  })

  it('returns empty for an empty document', () => {
    expect(parseCSVTable('')).toEqual({ headers: [], rows: [] })
  })
})
