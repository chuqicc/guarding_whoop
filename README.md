# NBA Guard Annotation

Annotate **defensive assignments** in NBA games — who guards whom, half-second by half-second — on top of SportVU player-tracking data.

Built for research: every annotation keys back to its source tracking frame, and two annotators' files can be compared to produce an inter-rater reliability figure.

<!-- SCREENSHOT: main annotation view (court + roster + grid) -->
<p align="center">
  <img src="images/main.png" width="600">
</p>

---

## Install

Download the latest installer from [Releases](../../releases).

| Platform | File |
|---|---|
| Windows | `guardingwhoop-Setup-<version>.exe`, or `-Portable-` to run without installing |
| macOS | `guardingwhoop-<version>-arm64.dmg` |

The builds are not code-signed yet, so the first launch needs one extra click:

- **Windows** — SmartScreen → *More info* → *Run anyway*
- **macOS** — right-click the app → *Open*

---

## What it does

### Annotate a quarter

Load a quarter of SportVU tracking and assign each on-court defender to the attacker they are guarding.

- **Animated court** — all ten players and the ball, with flip controls (⇆ ⇅)
- **0.5-second buckets** — one annotation covers half a second
- **Carry-forward memory** — each bucket inherits the previous assignment, so you mark only what *changes*
- **Automatic dead-ball marking** — stoppages are detected from the tracking data when a file is first opened (see below)
- **Video sync** — anchor the footage to the tracking once, and it follows every jump from then on
- **Shot and rebound flags**, **confidence ratings** (1–3), and **notes** tied to a moment
- **Undo / redo** on every edit, and continuous autosave

<!-- SCREENSHOT: annotation grid with a few assignments -->

### Dead balls, marked for you

Opening a quarter for the first time marks its dead balls automatically, from three signals in the tracking data:

| Signal | Catches |
|---|---|
| Shot clock held at exactly 24 | Made basket → inbound, free throws, timeouts |
| A gap of more than 2s between frames | Whistles the tracking stops recording through |
| Ball through the hoop just before a reset | Back-dates the start to the basket itself |

This runs **once per file**, never again — your corrections are never overwritten. Every mark is an ordinary annotation afterwards: click to change it, `⌘Z` to undo. `⟳ Re-mark dead` starts over if you want it.

Buckets with no shot clock at all — mostly a quarter's closing seconds — are hatched, because the rules cannot speak for them.

> Roughly 7–12% of a quarter is marked, across 30–40 stoppages. Review them against the video as you go; the marking is a starting point, not a verdict.

### Two views of the same work

| View | Shows |
|---|---|
| **▦ Grid** | One column per 0.5s bucket — how the work is entered |
| **▬ Spells** | Consecutive buckets on one attacker merged into a bar — *"#23 marked #7 for 6.5s, then switched"* |

Spells marks why each stretch ended (⇄ switch · ■ dead ball · ⇆ defence swap · · gap), surfaces its weakest confidence, and moves the playhead when you click a bar.

<!-- SCREENSHOT: spells view -->

### Compare two annotators

Drop in two exported files for the same quarter for a reliability report and a per-disagreement review.

- Accepts **JSON or CSV**, and the two sides may differ in format
- Metrics ordered by how far they can be trusted: **switch-event F1** (±1s tolerance) first, then dead-ball agreement, **Cohen's κ**, and the carry-forward-inflated raw rate last
- Every excluded cell is accounted for: coverage mismatch, dead ball, defending-team mismatch
- **One lane per disagreement type** on a shared clock axis, plus the per-defender grid
- **By-defender table** — each defender's own agreement rate and κ, worst first
- **Review view** — load the tracking and footage, then step disagreements with `n` / `p` with court and video in view
- **Exports** — a self-contained HTML reliability report (with a draft methods paragraph) or a disagreement CSV

<!-- SCREENSHOT: compare view with metric cards + diff bars -->

> **Read the caveats panel before quoting a number.** Carry-forward fills most buckets, so adjacent cells are highly autocorrelated and cell-level figures run high. Switch-event F1 is the metric that characterises annotation quality.

---

## How to use

### Annotating

1. Click **Annotate Quarter**
2. Optionally load `player_data.csv`, then drop in the quarter tracking JSON
3. Optionally load a game video
4. Scrub the video to the moment shown on court, then click **⚓ Sync here** — jumps carry the video from then on
5. **Assign** by dragging an attacker from the roster onto a defender's cell, or onto `∅` for "guarding no one". Clicking a defender then an attacker on court works too.
6. Toggle the defending team as possession changes; assignments for both teams are kept
7. Review the automatic dead-ball marks and correct any that are wrong
8. Export with **⬇ JSON** / **⬇ CSV**

**⬆ Import JSON** / **⬆ Import CSV** resumes from a previous export.

### Comparing

1. From the home screen, click **Compare Annotators**
2. Drop each annotator's file into the A and B panels
3. Read the metric cards, then step disagreements with `n` / `p`
4. **⬇ Disagreements CSV** for discussion

Files from different games or quarters are refused rather than compared — those numbers would look fine and mean nothing.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` `→` | Step one column (one 0.5s bucket) |
| `1` `2` `3` | Confidence on the focused cell |
| `Esc` | Clear the focused cell or court selection |
| `⌘`/`Ctrl` + `Z` | Undo |
| `⌘`/`Ctrl` + `Shift` + `Z` | Redo |
| `n` / `p` | Next / previous disagreement *(compare view)* |

For frame-exact positioning, use **`-5f` `-1f` `+1f` `+5f`** in the playback bar.

---

## Export formats

**JSON** (`guard-annotation/v2`) — one entry per 0.5s bucket with frame and moment ranges, plus a metadata block holding game, quarter, rosters and annotator. This is the format to keep.

Dead buckets carry `dead_source` (`auto` or `manual`), and a bucket the rules marked and you cleared carries `auto_cleared`. Both annotators get the same automatic marks, so any difference between two files is a human decision.

**CSV** — one row per frame per on-court defender, for joining directly against the raw tracking data:

| Field | Description |
|---|---|
| `game_id`, `quarter` | Game identifiers |
| `frame`, `moment_id` | Frame index and SportVU moment timestamp |
| `gamestatus` | `active` or `dead` |
| `defending_team`, `attacking_team` | Team abbreviations |
| `defender_*`, `attacker_*` | Jersey, id, name. `GUARD_NONE` = marking no one; empty = not annotated |
| `confidence` | 1–3 |
| `quarter_clock`, `shot_clock` | Clock values |
| `is_shot`, `is_rebound` | Bucket-level event flags |
| `annotator` | Who produced the file |

Both formats carry the same content and round-trip losslessly.

**Notes CSV** — free-text observations, exported separately. Each row leads with the game clock (`1:45.5`) and keeps the raw bucket alongside it for joining.

---

## Good to know

- **Set your annotator name** in the top bar. It is written into every export and labels the two sides in the comparison view.
- Work is autosaved to local storage, keyed per source file. A **SAVE FAILED** badge means storage is full — export immediately.
- Video sync rests on a single anchor. If a clip has been edited internally, re-anchor with **⚓ Re-sync** nearer the part you are working on.

---

## Development

```bash
npm install
npm run dev            # browser at localhost:5173
npm run electron:dev   # desktop shell
npm run check          # lint + typecheck + tests
npm run build          # production bundle
npm run electron:dist  # package for macOS + Windows
```

Push a `v*` tag to cut a release; the workflow builds and attaches the Windows and macOS artifacts.

**Stack:** React 19 · Zustand · react-konva · Vite · Electron · Vitest
