// Guarded localStorage access.
//
// The annotation payload for one quarter is ~830KB against a ~5MB quota, keys
// are never evicted, and the cached player CSV competes for the same budget.
// Every setItem in the store used to be unguarded, so a QuotaExceededError
// threw out of the middle of a cell write and the annotator lost the edit with
// no indication anything had gone wrong.

export type StorageStatus =
  | { state: 'ok' }
  | { state: 'saving' }
  | { state: 'failed'; message: string }

type Listener = (status: StorageStatus) => void

const listeners = new Set<Listener>()
let status: StorageStatus = { state: 'ok' }

export function subscribeStorageStatus(fn: Listener): () => void {
  listeners.add(fn)
  fn(status)
  return () => { listeners.delete(fn) }
}

export function getStorageStatus(): StorageStatus {
  return status
}

function setStatus(next: StorageStatus) {
  status = next
  for (const fn of listeners) fn(next)
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014
  )
}

/** Keys that may be dropped to make room. Ordered least-valuable first. */
const EVICTABLE = ['pdata_csv', 'pdata_name']

/**
 * Write a key, surviving a full quota. Returns true when the value landed.
 * Never throws: a failed save raises a status the UI must surface.
 */
export function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    if (status.state === 'failed') setStatus({ state: 'ok' })
    return true
  } catch (e) {
    if (!isQuotaError(e)) {
      setStatus({ state: 'failed', message: `Could not save: ${String(e)}` })
      return false
    }
    // Free the caches that are cheap to rebuild, then retry once.
    let freed = false
    for (const k of EVICTABLE) {
      if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); freed = true }
    }
    if (freed) {
      try {
        localStorage.setItem(key, value)
        if (status.state === 'failed') setStatus({ state: 'ok' })
        return true
      } catch { /* fall through to the hard failure below */ }
    }
    setStatus({
      state: 'failed',
      message: 'Storage is full — your latest changes are NOT saved. ' +
               'Export your annotations now, then clear old sessions.',
    })
    return false
  }
}

/**
 * Read and JSON-parse a key. A corrupt value is moved aside rather than left
 * to throw out of loadQuarter, which previously made the file unopenable.
 */
export function parseOrQuarantine<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  let raw: string | null
  try { raw = localStorage.getItem(key) } catch { return null }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isValid(parsed)) return parsed
    throw new Error('failed validation')
  } catch {
    try {
      localStorage.setItem(`corrupt_${key}_${Date.now()}`, raw)
      localStorage.removeItem(key)
    } catch { /* nothing more we can do */ }
    setStatus({
      state: 'failed',
      message: `Saved data under "${key}" was unreadable and has been set aside ` +
               `(kept as corrupt_${key}_…). That part of the session did not load.`,
    })
    return null
  }
}

export const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every(n => typeof n === 'number' && !isNaN(n))
