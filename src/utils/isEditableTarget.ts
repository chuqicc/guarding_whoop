/**
 * True when a keyboard event originated inside a text-entry control.
 *
 * Global shortcuts must not fire while the annotator is typing. The previous
 * checks were both wrong: App.tsx tested only HTMLInputElement, so Space in the
 * notes textarea toggled playback AND was swallowed by preventDefault (you
 * could not type a multi-word note); AnnotationArea had no check at all, so
 * "1"/"2"/"3" rewrote the focused cell's confidence from any text field.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true

  // Match on the attribute rather than the isContentEditable property: it also
  // catches an element nested inside an editable region, and does not depend
  // on the element being rendered.
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}
