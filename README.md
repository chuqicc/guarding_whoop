# NBA Guard Annotation Tool

A desktop application for annotating defensive assignments in NBA games using SportVU player-tracking data.

---

## Download

Get the latest Windows installer from the [Releases](../../releases) page.

---

## Features

### Annotate Quarter
Load a full-quarter SportVU tracking JSON file and annotate every defender's assignment frame by frame.

- Animated court view shows all 10 players moving in real time
- Assign each on-court defender to the attacker they are guarding
- 1-second time buckets — one annotation covers an entire second of play
- Mark dead-ball periods (out of bounds, free throws, timeouts) to exclude them from analysis
- Sync a game video alongside the tracking animation for reference
- Export results as CSV or JSON, keyed by frame and moment ID for direct join with tracking data

### Video Quarter Splitter
Split a full-game video file into individual quarter clips.

- Drop in any video file (mp4, mov, mkv, …)
- Set start and end timestamps by playing the video and clicking **Set**
- Split and download all quarters in one click using FFmpeg under the hood

---

## How to Use

### Annotate Quarter — basic workflow

1. Launch the app and click **Annotate Quarter**
2. Drop your SportVU quarter JSON file onto the upload area
3. Optionally load a video file for side-by-side reference
4. Use the court animation to navigate frames
5. Click a defender row in the roster, then click the attacker they are guarding in the assignment table
6. Mark any dead-ball seconds using the **Dead** toggle in the annotation table
7. Click **⬇ CSV** or **⬇ JSON** to export when done

### Video Quarter Splitter — basic workflow

1. Launch the app and click **Video Quarter Splitter**
2. Drop your full-game video onto the player area
3. Click **Upload** to send the file to the local split server
4. Play the video to each quarter boundary and click **⊙ Set** to mark start and end times
5. Click **✂ Split & Download** — each quarter downloads automatically when ready

---

## Export Format

**CSV** — one row per frame per on-court defender:

| Field | Description |
|---|---|
| `game_id` | NBA game identifier |
| `quarter` | Quarter number |
| `frame` | Frame index in the tracking data |
| `moment_id` | SportVU moment timestamp (links back to raw tracking) |
| `gamestatus` | `active` or `dead` |
| `defending_team` / `attacking_team` | Team abbreviations |
| `defender_jersey` / `defender_id` / `defender_name` | Defending player |
| `attacker_jersey` / `attacker_id` / `attacker_name` | Assigned attacker (`GUARD_NONE` if unguarded) |
| `quarter_clock` / `shot_clock` | Clock values at this frame |

**JSON** — same data in a nested structure: one metadata block + an array of frame objects each containing an `assignments` array.

---

## Notes

- All annotation data is auto-saved in the browser's local storage — you can close and reopen the app without losing progress
- The video sync feature supports multiple sync points to handle dead-ball gaps in the tracking data
- Windows SmartScreen may show a warning on first launch — click **More info → Run anyway**
