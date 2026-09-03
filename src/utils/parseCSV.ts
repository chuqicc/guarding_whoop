import type { Player } from '../store/useStore'

// ── player_data.csv ───────────────────────────────────────────────────────

export function parsePlayerDict(csvText: string): Record<number, Player> {
  const lines = csvText.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const dict: Record<number, Player> = {}

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i], headers)
    if (!row.player_id) continue
    const pid = parseInt(row.player_id)
    dict[pid] = {
      id: pid,
      name: (row.player_name || '').trim(),
      jersey: String(parseInt(row.jersey_number) || 0),
      teamId: parseInt(row.team_id),
      teamAbbr: (row.team || '???').trim().toUpperCase(),
    }
  }
  return dict
}

function parseRow(line: string, headers: string[]): Record<string, string> {
  const values = line.split(',')
  const row: Record<string, string> = {}
  headers.forEach((h, i) => { row[h] = (values[i] || '').trim() })
  return row
}
