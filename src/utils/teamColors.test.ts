import { describe, it, expect, beforeEach } from 'vitest'
import { resolveTeamColors, isHexColor, DEFAULT_TEAM_COLORS } from './teamColors'
import { useStore } from '../store/useStore'

describe('resolveTeamColors', () => {
  it('falls back to the defaults when nothing is overridden', () => {
    expect(resolveTeamColors({ a: null, b: null })).toEqual({ ...DEFAULT_TEAM_COLORS })
  })

  it('overrides one side without disturbing the other', () => {
    expect(resolveTeamColors({ a: '#112233', b: null }))
      .toEqual({ a: '#112233', b: DEFAULT_TEAM_COLORS.b })
  })
})

describe('isHexColor', () => {
  it.each(['#abc', '#ABCDEF', '#123456'])('accepts %s', v => {
    expect(isHexColor(v)).toBe(true)
  })

  it.each(['abc', '#12345', 'red', 'rgb(1,2,3)', '', null, 42])('rejects %s', v => {
    expect(isHexColor(v)).toBe(false)
  })
})

describe('team colours in the store', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ teamColors: { a: null, b: null } })
  })

  it('persists a pick so it survives a reload', () => {
    useStore.getState().setTeamColor('a', '#00ff00')
    expect(useStore.getState().teamColors.a).toBe('#00ff00')
    expect(JSON.parse(localStorage.getItem('teamcolors')!)).toEqual({ a: '#00ff00', b: null })
  })

  it('stores colours once for the app, not per quarter file', () => {
    // A viewing preference should not reset every time another file is opened,
    // so the key carries no filename.
    useStore.getState().setTeamColor('b', '#ff00ff')
    // jsdom's localStorage is not a plain object, so enumerate it properly.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
    expect(keys).toContain('teamcolors')
    expect(keys.filter(k => k.includes('quarter'))).toEqual([])
  })

  it('resets both sides back to the defaults', () => {
    useStore.getState().setTeamColor('a', '#00ff00')
    useStore.getState().setTeamColor('b', '#ff00ff')
    useStore.getState().resetTeamColors()
    expect(useStore.getState().teamColors).toEqual({ a: null, b: null })
    expect(resolveTeamColors(useStore.getState().teamColors)).toEqual({ ...DEFAULT_TEAM_COLORS })
  })

  it('keeps the pair independent', () => {
    useStore.getState().setTeamColor('a', '#00ff00')
    useStore.getState().setTeamColor('b', '#ff00ff')
    useStore.getState().setTeamColor('a', null)
    expect(useStore.getState().teamColors).toEqual({ a: null, b: '#ff00ff' })
  })
})
