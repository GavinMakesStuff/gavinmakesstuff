# Media Organizer

A Windows desktop app to help Gavin clean up a large, messy collection of
photos/videos/audio: find duplicates (even when Windows doesn't recognize
them as duplicates because the name or date differs), keep the
highest-quality copy of each, and apply naming conventions across the
Photography and Memories folders.

## Safety model (read this first)

**Nothing is ever permanently deleted by this app.** The #1 priority stated
for this project is never losing a unique file, so:

- Duplicate detection only ever recommends a "keep" and flags the rest as
  "discard" - it never deletes anything itself.
- Applying a duplicate-cleanup plan **moves** discarded files into a review
  folder you choose (default: `<scanned folder>\_duplicates-review`), it
  does not delete them. You look through that folder yourself and delete
  for real whenever you're confident.
- Every move is logged to `undo-log.jsonl` in the review folder as it
  happens, and there's an "Undo Last Move" button that reads that log and
  puts every file back where it came from.
- A move never overwrites an existing file. If the destination is already
  taken, the app appends `(2)`, `(3)`, etc. rather than clobbering
  something.
- Renames work the same way - never overwrites, always logged.

## How duplicate detection works

1. **Exact duplicates** - every file is hashed (SHA-256) and files with
   identical bytes are grouped, regardless of filename or date. This is
   what catches "Windows copied it twice because the name/date differed but
   the content is identical."
2. **Near-duplicate images** - a perceptual hash (dHash) is computed for
   every image and images that are visually the same but not
   byte-identical (e.g. the same photo exported twice at different quality,
   or lightly edited) are grouped together too.
3. Each group is quality-ranked (resolution first, then bitrate, then
   format - RAW/lossless beats re-compressed JPEG - then file size as a
   final tie-breaker) and the best copy is recommended as the keeper.
4. If one copy in a group has a real, human-typed filename (e.g. "Grandmas
   80th birthday.jpg") and the recommended keeper has a camera-generated
   name (e.g. "IMG_1234.jpg"), the app suggests renaming the keeper to the
   human name instead of losing that naming work when the other copy is
   moved out.

Video/audio near-duplicates (same content, different encode) aren't
auto-grouped yet - that needs real audio/video fingerprinting (e.g.
chromaprint), which isn't wired in. Exact video/audio duplicates (identical
bytes) are still caught fine.

## Naming conventions supported

**Photography**: `<Year>/<City, County, or Trip Name>/<Location> - <Image
description> - <001>[edit letter]`, e.g. `Chicago - Skyline at dusk -
014.jpg`, with edit variants of the same shot sharing a number and getting
`a`/`b`/`c` suffixes (`014a.jpg`, `014b.jpg`). The app scans a folder,
flags files that don't match the pattern yet, and tells you the next free
sequence number for that folder.

**Memories**: `<Year>/<Group, Trip, or Event>/<description of what's
happening or who's present>`. The app validates files are filed two
folders deep under a real year, flags a year folder that doesn't match the
file's actual capture date, and flags files that still have a
camera-generated name instead of a real description.

Neither the resolution/bitrate quality check nor the naming checks can
*invent* a description for you - that's inherently a human judgment call.
The app's job is to find what needs your attention and make it fast to fix,
not to guess your captions.

## Running in development

```
npm install
npm start
```

## Running the tests

```
npm test
```

Core logic (scanning, hashing, perceptual hashing, quality ranking, naming
parsing, the safe-move/quarantine system) is covered by `node --test` in
`test/` - no Electron/GUI dependency needed to run these.

## Building a Windows installer

```
npm run dist:win
```

This uses `electron-builder` to produce an NSIS installer (`.exe`) in
`dist/`. It bundles a real `ffprobe` binary (via `ffprobe-static`) so video
resolution/bitrate comparisons work out of the box - no separate ffmpeg
install needed.

## Project layout

```
src/
  main.js              Electron main process - IPC handlers wiring the UI to core/
  preload.js           Exposes a narrow window.api surface to the renderer
  renderer/             Plain HTML/CSS/JS UI (three tabs: duplicates, photography naming, memories naming)
  core/
    scanner.js           Recursive, read-only walk of a folder for media files
    hashing.js           Exact (SHA-256) duplicate detection
    perceptualHash.js    Near-duplicate image detection (dHash)
    mediaProbe.js        ffprobe wrapper for video/audio resolution & bitrate
    qualityRank.js       Decides which copy in a duplicate group is "best"
    duplicateGrouper.js  Combines exact + near-duplicate detection into ranked groups
    safeMove.js          Collision-proof, verified file moves (core safety primitive)
    planner.js           Turns duplicate groups / naming suggestions into a reviewable plan
    planExecutor.js       Executes a plan with a persistent undo log
    naming/
      namingEngine.js      Shared helpers: camera-generated-name detection, filename sanitizing
      photography.js       Photography convention parse/build/sequencing
      memories.js          Memories convention path validation
test/                  node:test coverage for everything in core/
```

## Status / what's left

This is an initial build. Still to do:
- Wire up an inline "rename with this name" action in the Photography tab
  (currently it only reports what needs attention; applying the rename via
  `buildRenamePlan`/`executePlan` is implemented in core but not yet
  exposed as a one-click button in the UI).
- Video/audio perceptual fingerprinting for near-duplicates.
- Batch "apply all suggested keeper names" workflow for the duplicate
  results tab.
- App icon / packaging polish.
