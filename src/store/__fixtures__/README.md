# Test fixtures

## `legacy-session.json` — REQUIRED before the Phase 2 storage migration

Not yet captured. Produce it by running `scripts/dump-legacy-session.js` in the
devtools console of an app instance holding a **real, in-progress RA session**,
then commit the downloaded file here as `legacy-session.json`.

`src/store/migrate.test.ts` replays this fixture through the v3 migration and
asserts cell-for-cell equality. Without a real capture that test can only prove
the migration works on data we invented, which is not the risk we care about:
the risk is a bucket-key or defending-team edge case that only appears in real
annotation work.
