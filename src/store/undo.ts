// Undo/redo as a command stack.
//
// A snapshot approach (zundo) would copy the whole annotation set per step and,
// more importantly, could not express "these five carry-forward writes are one
// step". Inverse ops give exact granularity plus a label to show the annotator.

import type { CellAnnotation } from './useStore'

/** The four slices of annotation state a transaction can touch. */
export interface UndoPatch {
  cellAnnotations?: CellAnnotation[]
  deadTimeBuckets?: number[]
  shotBuckets?: number[]
  reboundBuckets?: number[]
}

export interface Txn {
  label: string
  before: UndoPatch
  after: UndoPatch
  ts: number
  /** Machine-generated (carry-forward auto-fill), not something the user asked for. */
  implicit: boolean
}

const LIMIT = 200

let undoStack: Txn[] = []
let redoStack: Txn[][] = []   // each entry is one user-visible undo group

export function resetHistory(): void {
  undoStack = []
  redoStack = []
  notify()
}

export function pushTxn(txn: Txn): void {
  undoStack.push(txn)
  if (undoStack.length > LIMIT) undoStack.shift()
  redoStack = []
  notify()
}

/**
 * Merge a chronologically-ordered list of patches; later values win.
 * Undo feeds this the group's `before` patches oldest-last, redo feeds it the
 * `after` patches newest-last, so in both cases "last write wins" is correct.
 */
function merge(patches: UndoPatch[]): UndoPatch {
  const out: UndoPatch = {}
  for (const p of patches) Object.assign(out, p)
  return out
}

/**
 * Compute the patch a single Ctrl+Z should apply, and consume it.
 *
 * Playing through 20 buckets at 1x generates 20 carry-forward transactions in
 * ten seconds. If each consumed an undo press, Ctrl+Z would be useless. So undo
 * reverts every consecutive implicit transaction plus the first explicit one
 * beneath them, as one visible step: users want to undo the last thing *they*
 * did, not the last thing the app did for them.
 */
export function undo(): { patch: UndoPatch; label: string } | null {
  if (undoStack.length === 0) return null

  const group: Txn[] = []
  while (undoStack.length > 0) {
    const txn = undoStack.pop()!
    group.push(txn)                 // group is newest-first
    if (!txn.implicit) break
  }
  redoStack.push([...group].reverse())   // store chronologically

  // Apply `before` newest-first so the oldest transaction's `before` wins.
  const patch = merge(group.map(t => t.before))
  const label = (group.find(t => !t.implicit) ?? group[0]).label
  notify()
  return { patch, label }
}

export function redo(): { patch: UndoPatch; label: string } | null {
  const group = redoStack.pop()          // chronological
  if (!group || group.length === 0) return null

  undoStack.push(...group)
  // Apply `after` oldest-first so the newest transaction's `after` wins.
  const patch = merge(group.map(t => t.after))
  const label = (group.find(t => !t.implicit) ?? group[group.length - 1]).label
  notify()
  return { patch, label }
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

type Listener = (s: HistoryState) => void
const listeners = new Set<Listener>()

function snapshot(): HistoryState {
  // Report the label of the first explicit txn undo would reach — that is the
  // step the user perceives.
  let i = undoStack.length - 1
  while (i >= 0 && undoStack[i].implicit) i--
  const nextRedo = redoStack.at(-1)
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: i >= 0 ? undoStack[i].label : (undoStack.at(-1)?.label ?? null),
    redoLabel: nextRedo ? (nextRedo.find(t => !t.implicit) ?? nextRedo.at(-1)!).label : null,
  }
}

function notify() {
  const s = snapshot()
  for (const fn of listeners) fn(s)
}

export function subscribeHistory(fn: Listener): () => void {
  listeners.add(fn)
  fn(snapshot())
  return () => { listeners.delete(fn) }
}

export function getHistoryState(): HistoryState {
  return snapshot()
}
