/**
 * Golden-fixture capture for the v3 storage migration (Phase 0.1).
 *
 * WHY: the Phase 2 migration rewrites every RA's in-progress annotations from
 * the legacy localStorage layout into the v3 IndexedDB document. The only way
 * to prove that migration is lossless is to replay it against a REAL session.
 *
 * HOW TO RUN
 *   1. Open the annotation app with a quarter loaded and real work in it.
 *   2. Open devtools (Electron: View -> Toggle Developer Tools; browser: F12).
 *   3. Paste this whole file into the Console and press Enter.
 *   4. A `legacy-session.json` file downloads. Commit it to
 *      src/store/__fixtures__/legacy-session.json
 *
 * The dump contains only annotation data (player ids, jersey numbers, bucket
 * keys and timings). It does not contain video, tracking data, or anything
 * about the person annotating beyond the annotator name they typed.
 */
(function dumpLegacySession() {
  const PREFIXES = [
    'annotation_', 'deadtime_', 'shot_', 'rebound_',
    'membarrier_', 'notes_', 'anntime_',
  ]
  const GLOBALS = ['autoFillMemory', 'annotatorName', 'pdata_name']

  const dump = { capturedAt: new Date().toISOString(), keys: {} }
  let matched = 0

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    const isSession = PREFIXES.some(p => key.startsWith(p))
    if (!isSession && !GLOBALS.includes(key)) continue
    // pdata_csv is deliberately excluded — it is large and is not migrated.
    dump.keys[key] = localStorage.getItem(key)
    matched++
  }

  if (matched === 0) {
    console.warn('No legacy annotation keys found. Load a quarter with saved work first.')
    return
  }

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'legacy-session.json'
  a.click()
  URL.revokeObjectURL(a.href)

  console.log(`Captured ${matched} legacy keys:`, Object.keys(dump.keys))
})()
