import { useStore } from '../store/useStore'
import { COLOR_TEAM_A, COLOR_TEAM_B } from '../constants'

/**
 * Team colours, with the annotator's overrides applied.
 *
 * Six places used to read `COLOR_TEAM_A` / `COLOR_TEAM_B` straight from the
 * constants, so the two shirt colours were fixed at blue and red. That is a
 * problem more often than it sounds: plenty of matchups are blue-on-red in
 * reality, and when the tracking animation disagrees with the footage playing
 * beside it, every glance between the two costs a beat.
 *
 * `null` means "unchanged", and resolves to the built-in default rather than
 * being stored as a literal — so the defaults can move with the theme later
 * without stale copies sitting in everyone's local storage.
 */
export interface TeamColorOverrides { a: string | null; b: string | null }

export const DEFAULT_TEAM_COLORS = { a: COLOR_TEAM_A, b: COLOR_TEAM_B } as const

export function resolveTeamColors(o: TeamColorOverrides): { a: string; b: string } {
  return { a: o.a ?? DEFAULT_TEAM_COLORS.a, b: o.b ?? DEFAULT_TEAM_COLORS.b }
}

/** The pair to paint with. Re-renders when the annotator changes either. */
export function useTeamColors(): { a: string; b: string } {
  return resolveTeamColors(useStore(s => s.teamColors))
}

/** `#rgb` or `#rrggbb`; anything else is refused rather than written to state. */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
}
