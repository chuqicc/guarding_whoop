/**
 * RFC4180 CSV reading.
 *
 * The export side has quoted fields correctly since the CSV-escaping fix
 * (`csvEscape` in export.ts), but the import side still split on bare commas.
 * A player legitimately named "Smith, Jr." therefore exported fine and came
 * back with every column after the name shifted by one — which, for the
 * agreement comparison, silently reads someone else's id as the attacker.
 *
 * Line splitting also has to respect quoted newlines and strip CR, because a
 * CRLF file left "\r" glued to the final column (`annotator`) — the exact
 * field the annotator comparison keys on.
 */

/** Split one already-isolated CSV record into fields. */
export function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

/**
 * Split a whole CSV document into records, honouring newlines inside quoted
 * fields. Handles LF, CRLF and lone CR line endings.
 */
export function splitCSVRecords(text: string): string[] {
  const records: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a close.
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue }
      inQuotes = !inQuotes
      cur += c
      continue
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++      // CRLF counts once
      records.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.length > 0) records.push(cur)

  return records.filter(r => r.trim().length > 0)
}

/**
 * Parse a CSV document into a header list plus one record per row.
 * Rows are returned as field arrays; use `indexOf` on the headers to read them.
 */
export function parseCSVTable(text: string): { headers: string[]; rows: string[][] } {
  const records = splitCSVRecords(text)
  if (records.length === 0) return { headers: [], rows: [] }
  const headers = parseCSVLine(records[0]).map(h => h.trim())
  const rows = records.slice(1).map(parseCSVLine)
  return { headers, rows }
}
