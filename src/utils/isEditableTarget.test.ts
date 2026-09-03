import { describe, it, expect, afterEach } from 'vitest'
import { isEditableTarget } from './isEditableTarget'

const made: HTMLElement[] = []
function el(tag: string, setup?: (e: HTMLElement) => void): HTMLElement {
  const e = document.createElement(tag)
  setup?.(e)
  document.body.appendChild(e)
  made.push(e)
  return e
}
afterEach(() => { made.splice(0).forEach(e => e.remove()) })

describe('isEditableTarget', () => {
  it('guards a textarea — this is why Space could not be typed in a note', () => {
    // App.tsx tested `instanceof HTMLInputElement`, which a textarea is not,
    // so Space toggled playback and preventDefault swallowed the character.
    expect(isEditableTarget(el('textarea'))).toBe(true)
  })

  it('guards text inputs, selects and contenteditable', () => {
    expect(isEditableTarget(el('input'))).toBe(true)
    expect(isEditableTarget(el('select'))).toBe(true)
    expect(isEditableTarget(el('div', e => e.setAttribute('contenteditable', 'true')))).toBe(true)
  })

  it('guards an element nested inside a contenteditable region', () => {
    const region = el('div', e => e.setAttribute('contenteditable', 'true'))
    const inner = document.createElement('span')
    region.appendChild(inner)
    expect(isEditableTarget(inner)).toBe(true)
  })

  it('does not guard contenteditable="false"', () => {
    expect(isEditableTarget(el('div', e => e.setAttribute('contenteditable', 'false')))).toBe(false)
  })

  it('does not guard ordinary elements, so shortcuts still work', () => {
    expect(isEditableTarget(el('div'))).toBe(false)
    expect(isEditableTarget(el('button'))).toBe(false)
    expect(isEditableTarget(el('td'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
