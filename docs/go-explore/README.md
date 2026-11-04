# Go-Explore and H3 exploration — canonical entry point

**Status (2026-11-04): true ending reached.** One input-only tape plays from reset through all six visible phases and the final room of both loops: `out/h3/loop2/l2-ending-96340.json`, 96400 frames. The RAM gate [`h3_verify_ending.mjs`](../../scripts/h3_verify_ending.mjs) passes, and the video has `ramVerified=true` ([§10](#10-verified-results)).

The story, the lessons and the token cost are in the private artifact [Cuaderno Go-Explore H3](https://claude.ai/artifact/VFgvo4SAfhkz57YXU3N7nv). This README stays the reference. Command sequences and per-phase evidence are in [PROVENANCE.md](PROVENANCE.md). Steps V2–V4 of the [gameplay-control bot plan](../plan-bot-control-jugabilidad-2026-11-01.md) have not started.

Use this document to run, reproduce and verify the H3 exploration tools. The handoffs and plans in [§9](#9-historical-documents) keep the evidence and reasoning of each stage, but their instructions are no longer current.

Everything runs from the repo root, on the local certified bundle (g6), headless, without touching the engine. Tapes, videos and metrics live in `out/`, which is private and not in git.

**Terms used here:**

- **Tape:** an input-only recording (B3 schema). It lists which control is pressed or released at which cycle. Replaying it from reset gives the same game.
- **Frame:** 1/59.64 s of game time (`CYCLES_PER_FRAME` = 25152 cycles at 1.5 MHz).
- **Reset:** power-on. "Replay from reset" means no state restore is used.
- **Gate:** a script that replays a tape from reset and checks RAM rules. A result counts only after its gate passes.
- **Cell:** a Go-Explore archive entry: a coarse game state with the shortest tape that reaches it.
- **Beam:** a search that keeps the best N branches and extends each one with 14 short macros.
- **Donor route:** an earlier tape that the beam follows and only re-optimizes where it diverges.

## 1. Architecture

```text
 seed tape (B3) ──────┐                        ┌── lab.save()/restore() only between branches
 or reset + titleCoin │                        │
                      ▼                        │
            labCreateBoard(frozen bundle g6) ◄── portRead: tape events / P1 masks
                      │ onFrame: reads RAM (read-only) → look(), isFatal(), cellKey()
                      ▼
   search: Go-Explore | beam | maneuvers | bounded continuation
                      ▼
   input-only tape  {schema, profile, frames, events, sha256, h3:{goalFrame, signal, ramSha, ...}}
                      ▼
   replay from reset, no restore  →  RAM MATCH + signal (+ transition)
                      ▼
   h3_video.mjs check (RGBA = app)  →  MP4 export + metrics JSON  →  acceptance gate
```

Shared pieces, imported by every tool in this document:

| Piece | Role |
| --- | --- |
| [`src/v3_b3_bundle.mjs`](../../src/v3_b3_bundle.mjs) `selectB3Bundle` + [`src/v2_b1_frozen.mjs`](../../src/v2_b1_frozen.mjs) `loadFrozen` | Select and load the certified bundle. Without one, the tool fails with `V3_B3_NO_CERTIFIED_BUNDLE`. |
| [`src/v3_b3_lab_board.mjs`](../../src/v3_b3_lab_board.mjs) `labCreateBoard` | Lab board: `lab.advanceTo(n)`, `lab.save()` and `lab.restore(snap)`. |
| [`src/v3_b3_external_tape.mjs`](../../src/v3_b3_external_tape.mjs) `resolveB3LabTape` | Validate and load an external B3 tape. Checks the schema and `sha256 = sha256(JSON{schema,profile,frames,events})`. |
| [`src/v3_b3_tapes.mjs`](../../src/v3_b3_tapes.mjs) `b3Tape('titleCoinStart')` | Boot prefix (coin and Start) when there is no seed tape. |
| [`src/gngb_input_contract.mjs`](../../src/gngb_input_contract.mjs) | `defineInputSchedule` and `readScheduledPort` turn `{cycle, control, pressed}` events into port reads. `cycle = frame × CYCLES_PER_FRAME`. |
| [`games/gngb/state.mjs`](../../games/gngb/state.mjs) `look`, `BOSS_LIFE` | Read-only RAM labels, re-exported by [`src/h3_explore.mjs`](../../src/h3_explore.mjs). |
| [`src/h3_lab_maneuver.mjs`](../../src/h3_lab_maneuver.mjs) `maneuverFatal` | Fatal predicate: a hit without armor (`0x0503=3`), the death handler, or a lost life. |

RAM labels used as the search signal:

| Label | Address | Label | Address |
| --- | --- | --- | --- |
| Phase | `0x72` | Armor (0 = on, 1 = off) | `0xAC` |
| Checkpoint | `0x81` | Weapon (3 = shield) | `0x73` |
| Loop / room | `0x71` | Score (BCD) | `0x68–0x6B` |
| Lives | `0x60` | Mode | `0x0503` |
| X / Y | `0xA0:A1` / `0xA2:A3` | Handler | `0x0510:11` |
| Scroll | `0x58:59` | Ending flag | `0x7f` |

`ramSha` is the SHA-256 of RAM `0x0000–0x2FFF` at `h3.goalFrame`.

**Visible phase vs RAM value.** `0x72` starts at 0. Visible phase N is `0x72 = N−1`, and completing it is the transition `0x72: N−1 → N`. The final room is `0x72 = 6`.

## 2. Inventory and methods

Not every tool uses Go-Explore. There are four search methods, plus diagnostics, tape and video tools.

| Tool | Method / purpose | Status |
| --- | --- | --- |
| [`scripts/h3_explore.mjs`](../../scripts/h3_explore.mjs) + [`src/h3_explore.mjs`](../../src/h3_explore.mjs) | **Go-Explore** over P1 masks. Also `replay` (verification) and `import` (live tapes). | Current |
| [`scripts/h3_boss_search.mjs`](../../scripts/h3_boss_search.mjs) | **Beam search** with 14 macro actions, fixed segments and optional backtracking. | Current from `H3_SEED`; with `H3_POKE`, lab only |
| [`scripts/h3_boss_maneuver.mjs`](../../scripts/h3_boss_maneuver.mjs) | **Directed maneuvers**: a control run plus up to 3 routes from a prefix, at most 240 frames. | Current |
| [`scripts/h3_finish_phase.mjs`](../../scripts/h3_finish_phase.mjs) | **Bounded continuation** after the phase 1 boss: fixed-length left/right holds. | Phase 1 only |
| [`scripts/h3_finalize_phase3.mjs`](../../scripts/h3_finalize_phase3.mjs) | Seals a continuation as a verifiable final tape. | Phase 3 only |
| [`scripts/h3_finalize_phase.mjs`](../../scripts/h3_finalize_phase.mjs) + [`src/h3_phase_contract.mjs`](../../src/h3_phase_contract.mjs) | Generic sealing. Checks the prefix and the phase N transition. | Current. Validated on g6 for phases 4–6; adds `phase6Evidence` for N=6. |
| [`scripts/verify_h3_phase.sh`](../../scripts/verify_h3_phase.sh) | Generic gate. Exports the video and renames it `faseN` after PASS. | Current. Validated on g6 for phases 4–6. |
| [`scripts/h3_run_logged.sh`](../../scripts/h3_run_logged.sh) | Logs the `H3_*` variables, each command, its output and its exit code to `out/h3/phaseN/commands.log`. | Current |
| [`scripts/h3_verify_loop1.mjs`](../../scripts/h3_verify_loop1.mjs) | RAM-only gate for the end of loop 1: final room with `0x7f=0`, boss `0xff6` down to 0, exit `6→0`. | Current (loop 1) |
| [`scripts/h3_verify_ending.mjs`](../../scripts/h3_verify_ending.mjs) | RAM-only gate for the true ending. See [§10](#10-verified-results) for what it checks. Writes `out/h3/phase7/ending-gate.json`. | Current |
| [`src/h3_follow.mjs`](../../src/h3_follow.mjs) | Beam donor route (`H3_FOLLOW`): matches each branch to the nearest position on another tape. | Current |
| [`scripts/verify_h3_phase3.sh`](../../scripts/verify_h3_phase3.sh) | Acceptance gate: prefix, replays, RGBA parity, export and ffprobe. | Phase 3 only |
| [`scripts/h3_video.mjs`](../../scripts/h3_video.mjs) | Tape → RGBA parity with the app, MP4 and metrics JSON. | Current |
| [`scripts/h3_boss_inspect.mjs`](../../scripts/h3_boss_inspect.mjs) | Labels and visible sprites at given frames. | Diagnostic |
| [`scripts/h3_boss_trace.mjs`](../../scripts/h3_boss_trace.mjs) + [`src/h3_lab_trace.mjs`](../../src/h3_lab_trace.mjs) | Neutral causal trace of a RAM range. | Diagnostic |
| [`scripts/h3_boss_coverage.mjs`](../../scripts/h3_boss_coverage.mjs) | Compiled blocks that the tapes run and that no certified tape runs. | Diagnostic |
| [`scripts/h3_static_cover.mjs`](../../scripts/h3_static_cover.mjs) | Static closure against the bundle. Measures only. | Diagnostic |
| [`scripts/h3_tape.mjs`](../../scripts/h3_tape.mjs) + [`scripts/h3_tape_recorder.lua`](../../scripts/h3_tape_recorder.lua) + [`src/h3_tape_convert.mjs`](../../src/h3_tape_convert.mjs) | MAME recorder → B3 tape, with rewind and round trip. | Current (needs MAME) |
| [`src/h3_live_import.mjs`](../../src/h3_live_import.mjs) | Live tape (app) → B3 events at frame start, for `import`. | Current |
| [`src/h3_lab_poke.mjs`](../../src/h3_lab_poke.mjs) | `H3_POKE`: lab RAM writes. | Lab only; forbidden in phase tapes |

Tests: [`tests/test_h3_phase_contract.mjs`](../../tests/test_h3_phase_contract.mjs) (phase contract, no ROM), [`tests/test_h3_explore.mjs`](../../tests/test_h3_explore.mjs), [`test_h3_lab_maneuver.mjs`](../../tests/test_h3_lab_maneuver.mjs), [`test_h3_lab_trace.mjs`](../../tests/test_h3_lab_trace.mjs) and [`test_h3_tape_convert.mjs`](../../tests/test_h3_tape_convert.mjs). Run them with `node --test tests/test_h3_*.mjs`.

Other consumers: [`scripts/ao_controls_check.mjs`](../../scripts/ao_controls_check.mjs) produces the `check.record_sha256` that `import` validates. Out of scope: the visual bot in `bot/` (live, pixels only) and the earlier explorer of [V3.B3 G2.1](../agents/v3-b3-g2-explorer-task.md).

## 3. Interfaces

All outputs are private, with mode `0600`. Exit codes are given in parentheses.

### `h3_explore.mjs`

```sh
node scripts/h3_explore.mjs explore [--from <tape.json>] [seed=1] [iters=Infinity] [minutes=30]
node scripts/h3_explore.mjs replay <tape.json> [every=0]
node scripts/h3_explore.mjs import <live-tape.json> [frame] [--unverified]
```

- **explore** (0 goal reached, 2 no goal, 3 failure):
  - Without `--from`, it boots with `titleCoinStart`, and P1 masks start at frame 1200. The goal is `0x72=0` with `scroll ≥ 3072`: the phase 1 boss arena.
  - With `--from`, it replays the tape up to `h3.goalFrame` and requires the same `h3.ramSha`. It refuses to start from a tape with `inputsLive=false`. The goal is any `0x72` other than the start phase.
  - `H3_RANK=y` ranks by armor, then height. `H3_RANK=height` ranks by height first ([§6](#6-search-criteria)).
  - It writes `out/h3/explore/cells-[s2-]s<seed>-i<iters>.json` (no snapshots) and `tape-[s2-]s<seed>-<frame>-{arena|phase|best}.json`, with `frames = goalFrame + 60`. The `s2-` prefix means `--from`, whatever the phase.
  - The tape releases every control at `goalFrame`, so a beam that continues from it starts at `goalFrame + 1`.
- **replay** (0 `MATCH`/`NO_REFERENCE`, 1 `MISMATCH`, 3 stop): replays from reset, without restore, up to `h3.goalFrame`. It compares `ramSha`, `signal` and, if present, `transitionFrame`.
- **import**: writes `tape-live-<name>-<frame>.json` and sets `inputsLive`. It exits with 3 if `check.record_sha256` fails, or if there is no check and `--unverified` is missing.

### `h3_boss_search.mjs`

```sh
[H3_SEED=<tape>] [H3_*=...] node scripts/h3_boss_search.mjs <ram-phase> [start=2200] [step=60] [end=9000]
```

- `<ram-phase>` is the `0x72` value the board must have at `start`. Otherwise it fails with `H3_BOSS_START_PHASE`.
- At each depth it tries the 14 actions from every beam member. It prunes dead branches and branches that lost a life. It deduplicates by position, armor, handler, score and scroll, and keeps `H3_WIDTH` branches.
- Branch value: `WX·min(maxX, XCAP) + WY·maxY + WCY·min(Y, YCAP) + WU·(y0 − minY) + WS·score − WA·armor − WB·Σlife`. A phase change is worth 10⁹.
- `H3_FOLLOW=<tape>:<offset>` adds a 15th action, `follow`. It replays the donor tape's P1 inputs from the matched point. The value then adds `WF·(donor frames advanced − WD·(|dx|+|dy|))`.
- `H3_KEEP_WEAPON` prunes every branch whose weapon `0x73` differs.
- The initial mask is the set of controls the seed holds at `start`, with or without `H3_FOLLOW`.
- It writes `out/h3/boss/search-p<phase>-<frame>[-<H3_TAG>].json`, with `frames = frame + 300` and `h3:{poke, route, ...}`. Exit codes: 0 `PHASE_ADVANCED`, 2 no advance.
- Without `H3_POKE`, `h3` also gets `goalFrame` (the saved head), `signal` and `ramSha`. `replay` can verify that tape and `explore --from` can continue from it. These fields do not change the tape SHA.

### `h3_boss_maneuver.mjs`

```sh
[H3_STEP=23] [H3_HORIZON=240] node scripts/h3_boss_maneuver.mjs <tape.json> <prefix> <name=action,...> [up to 3 specs]
```

- It replays the tape (with its poke, if any) up to `prefix`. Then it runs the control and each route from `prefix+1` to `prefix + H3_HORIZON`.
- Actions and cadence are in `MANEUVER_ACTIONS` ([`src/h3_lab_maneuver.mjs`](../../src/h3_lab_maneuver.mjs)). `idle` is the wait action.
- It releases held controls and writes `out/h3/boss/f2/maneuver-<prefix>-<name>.json` (`frames = END + 1`) and `maneuvers-<prefix>.json`. The `f2` directory keeps its historical name.
- Exit code 0 if every route ends with `FRAMES_DONE`.

### Continuation, sealing and acceptance

```sh
node scripts/h3_finish_phase.mjs <boss-defeated-tape.json>        # → out/h3/explore/tape-s2-phase-<goal>.json
node scripts/h3_finalize_phase3.mjs <candidate.json> <end>         # → out/h3/explore/tape-fase3-completa-<end>.json
bash scripts/verify_h3_phase3.sh <final-phase3-tape.json>          # → H3_PHASE3_ACCEPTANCE=PASS
node scripts/h3_finalize_phase.mjs <visible-phase> <seed-tape> <candidate> <goalFrame>
bash scripts/verify_h3_phase.sh <visible-phase> <seed-tape> <final-tape>
bash scripts/h3_run_logged.sh <visible-phase> <command> [args...]  # private log of commands and outputs
```

- `finish_phase` requires `h3.goalFrame ≥ 1200`, `ramSha` and `bossLife=0`. It tries `p1.left` and `p1.right` held for 120, 180, 240, 272 and 320 frames, with a 500-frame horizon. The first variant that changes `0x72` wins, and the goal is set to the transition + 60.
- `finalize_phase3` hardcodes the start tape, its hashes, `START=16980` and g6, and rejects `H3_POKE`. It requires exactly one `2→3` transition and released P1 controls.
- The historical phase 3 gate re-exports the video and writes logs to `/tmp/h3-phase3-*.log`.
- `finalize_phase` takes the visible phase N, the start tape and the cut frame from `h3.goalFrame`. It requires g6, an exact prefix, only new P1 inputs, released controls and one RAM transition N−1→N. It does not change `finalize_phase3`.
- `verify_h3_phase.sh` takes phase N, the seed and the final tape. It checks hashes, replay MATCH of both tapes, RGBA, MP4, `ffprobe`, `ramVerified=true` and exactly one phase event. After PASS it renames the files to `faseN.{mp4,json}`. Phase 3 keeps its old gate and interface.
- `h3_run_logged.sh` wraps every command that contributes to a tape. It logs the `H3_*` environment, arguments, output and exit code to `out/h3/phaseN/commands.log`. Use it for every search, maneuver, seal and gate. **Never** copy commands into §10 as results unless they were run.

### `h3_video.mjs`

```sh
node scripts/h3_video.mjs check  <tape.json> [frame=320]
node scripts/h3_video.mjs export <tape.json> [endFrame=tape.frames] [startFrame=1]
```

- `check` compares the RGBA pixels of one frame with the app's packaged modules (`out/android/assets/lib/`).
- `export` writes `out/h3/video/<tape>-<sha8>[-<start>]-<end>.{mp4,json}`: H.264 at 256×224 and `1500000/25152` fps.
- The JSON (`gng.h3.video-metrics.v1`) has per-frame rows, timed events (`inGame`, `phase`, `lives`, `stage`, `cp`, `armor`) and a summary. The summary counts only in-game frames, so boot-time RAM patterns are left out.
- `ramVerified=true` only if `endFrame = h3.goalFrame` and the RAM matches.

### Diagnostics and tapes

```sh
node scripts/h3_boss_inspect.mjs <tape.json> <f1,f2,...>
[H3_TRACE_WATCH=0x510:2] [H3_TRACE_BASELINE=<inspect.json>] node scripts/h3_boss_trace.mjs <tape.json> <from> <to> [a:b]
node scripts/h3_boss_coverage.mjs check | <search-tape.json>...
[H3_TAB=64] node scripts/h3_static_cover.mjs
node scripts/h3_tape.mjs selftest | selftest-rewind | record | convert <journal.txt> <tape.json>
```

- The trace accepts windows of up to 122 frames and read detail of up to 4. It writes `out/h3/boss/f2/trace-<from>-<to>.{txt,ram.bin,json}`.
- Coverage writes `out/h3/boss/coverage.json`.
- `h3_tape.mjs` needs `mame` on the PATH and `roms/`. Its `selftest*` modes run without video, sound or keyboard. `record` opens an interactive window: only the operator should use it.

## 4. Environment variables

| Variable | Tool | Default | Effect |
| --- | --- | --- | --- |
| `H3_SEED` | boss_search | titleCoinStart | Tape whose events before `start` are kept. |
| `H3_STEP` | boss_search / maneuver | positional / 23 | Segment length in frames. |
| `H3_WIDTH` | boss_search | 8 | Beam width. |
| `H3_WX`, `H3_WY`, `H3_WU`, `H3_WS` | boss_search | 1, 0, 0, 0.02 | Weights for max X, max Y, climb (`y0 − minY`) and score. |
| `H3_WCY`, `H3_YCAP` | boss_search | 0, 65535 | Weight of the current Y and its cap. Avoids rewarding a height already left behind. |
| `H3_WA` | boss_search | 2000 | Penalty for losing the armor. |
| `H3_WB`, `H3_BOSS_LIFE` | boss_search | 0, `0xe76` | Weight and addresses of the summed life bytes. See [§8](#8-known-limitations). |
| `H3_GOAL` | boss_search | — | `addr:value,…`. Success at the first frame, still in the phase, where every byte matches. Final room: `0x08:2`. |
| `H3_KEEP_WEAPON` | boss_search | — | `0x73` value every branch must keep. Shield: 3. |
| `H3_FOLLOW`, `H3_WF`, `H3_WD` | boss_search | —, 1, 1 | Donor route `<tape>:<offset>`, where offset = current frame − matching donor frame. Weights for progress along it and for distance. |
| `H3_TAG` | boss_search | — | `[a-z0-9-]` suffix for the output file. Required for parallel runs: without it, two beams with the same end frame overwrite each other. |
| `H3_XCAP` | boss_search | 65535 | Cap on rewarded X (arenas). |
| `H3_LAST` | boss_search | — | Save the final beam head instead of the best one. |
| `H3_BACKTRACK`, `H3_BACKTRACK_LIMIT` | boss_search | 0, unlimited | Go back N segments when every branch dies. |
| `H3_DEBUG` | boss_search | — | Log every pruned branch. |
| `H3_RANK` | explore | `x` | Only with `--from`. `y` ranks by armor, then height; `height` by height, then armor. For climbs where X and scroll do not grow. |
| `H3_GUARD` | explore | — | Only with `--from`. `addr,…` of life bytes. Sums their 1–2 drops along the trajectory (`dmg`) and adds them to the cell, to the ranking (before boss life) and to selection (`guardBias`=2 per hit). Phase 2: `0xcf6,0xd56`. |
| `H3_HORIZON` | maneuver | 240 (max) | Horizon of each route. |
| `H3_MANEUVER_REF` | maneuver | — | `<ram.bin>:<firstRecord>` of a trace, to compare the control run. |
| `H3_TRACE_WATCH`, `H3_TRACE_BASELINE` | trace | `0x510:2`, — | Watched range and comparison with an inspect output. |
| `H3_TAB` | static_cover | 64 | Table size of the static closure. |
| `H3_POKE` | search / maneuver / inspect / trace / coverage | — | `from:to:addr:value,...`. Lab only. `finalize_phase3` and the gate reject it. |
| `GNG_H3_*` | h3_tape → recorder.lua | — | Set by `h3_tape.mjs`; never set them by hand. |

## 5. End-to-end workflow

1. **Preflight.** Check that `node`, `ffmpeg`/`ffprobe`, `roms/gng.zip` and the certified g6 bundle exist. Then replay the seed tape and require `MATCH`:
   ```sh
   node scripts/h3_explore.mjs replay out/h3/explore/tape-fase4-completa-28260.json
   ```
2. **Seed.** Pick one of three: reset (`explore` without `--from`), a final tape with `h3.goalFrame` and `h3.ramSha` (`--from` or `H3_SEED`), or an imported live tape (`import`). To branch, the prefix must have every control released at the cut. If not, use `h3_boss_maneuver.mjs`, which releases them.
3. **Search.** The method depends on the stretch ([§6](#6-search-criteria)). Every search saves a resumable tape. Chain it with `H3_SEED` or pass it to `h3_boss_maneuver.mjs`.
4. **Final tape.** Seal it with `h3.goalFrame`, `h3.signal`, `h3.ramSha` and `h3.transitionFrom`/`transitionFrame`, without poke. For visible phases 4 and later, use `h3_finalize_phase.mjs` with phase N, seed, candidate and `goalFrame`. Phase 3 keeps `finalize_phase3`. Never overwrite the input tape.
5. **Replay.** `h3_explore.mjs replay <final>` must give `MATCH`.
6. **Video and acceptance.** Check with `h3_video.mjs check <final> <goalFrame>`. Export with `h3_video.mjs export <final> <goalFrame> <start>`, sharing the first frame with the previous video. Check codec, size, frame count, the `phase` event and `ramVerified=true` with ffprobe and the JSON. For visible phases 4 and later, `verify_h3_phase.sh` does all of this, including the rename after PASS. Phase 3 keeps `verify_h3_phase3.sh`.

## 6. Search criteria

- **Go-Explore.**
  - Cell: `(phase, checkpoint, X>>4, Y>>3, armor)`. With `--from`, the life byte `0x0E76` is added.
  - Each cell keeps the trajectory that keeps the armor and, on a tie, the one that takes fewer frames.
  - Selection weight: `(1 + scrollBonus·min(scroll, 3072)/3072) / √(1 + times chosen)`.
  - Each iteration plays 120 frames of sticky random actions from a fixed-seed mulberry32 and evaluates every 4 frames. The branch stops at the first fatal state. A hit with armor does not stop it; it creates another cell.
  - Best cell in S1: scroll, then X. With `--from`: phase, then lower boss life, then X. With `H3_RANK=y`: phase, kept armor, then height. With `H3_RANK=height`: phase, height, then armor. This lets the search continue from an upper floor even when an armor pickup leaves a better-equipped cell lower down.
- **Beam.** Fixed macros: `right`, `right_fire`, `right_jump`, `right_fire_jump`, `right_late_jump`, `fire`, `jump`, `duck_fire`, `left`, `left_fire`, `left_jump`, `up`, `up_fire`, `down`. The value is the one in §3.
  - In phases 2 and 3 it advanced with 120-frame segments in open stretches and 60-frame segments near hazards.
  - In the phase 5 tower, rewarding `maxY` misleads when the next ladder is far from the highest point. There, Go-Explore with `H3_RANK=y` found the ladders, and the beam with `H3_WY=3 H3_WS=1` handled enemies and the boss.
- **Boss gradient.** If the score only rises on the kill, the beam has no gradient during the fight and never hits the boss. Before searching, find the life byte: diff RAM on each hit in a tape where that boss already dies. Then use `H3_BOSS_LIFE=<byte> H3_WB≥1000 H3_GOAL=<byte>:0`. With several enemies alive at once, no single life measures progress: use `H3_GUARD` in `explore`.
- **Donor route.** Loop 2 repeats the geometry of loop 1. `H3_FOLLOW` with the loop 1 tape and the frame offset only re-optimizes where the branch diverges. With the shield on, add `H3_KEEP_WEAPON=3`, because any other weapon dooms phase 6.
- **Seeds.** The furthest heads of a search stopped by time are often already doomed. It works better to cut the tape a few frames earlier, with the controls released, and restart from there.
- **Maneuvers.** Short hand-written routes after watching the video, for example: walk to the key and wait for the transition. They do not search: they compare at most three variants against the control run.
- **Closing a phase.** Killing the boss does not close the phase. In phases 1–5 the bot had to wait for the key and pick it up. Rewarding X leaves the bot waiting at the right edge. The closing criterion is always the RAM transition of `0x72`, checked in the replay and in the video.
  - Phase 6 closes in routine `0x74b1`. Arthur must stand still (`0x503≠2`) within ±8 of a target point. Target X = `[0x5a]−0x30+0x55` (7717 in loop 2); target Y comes from `0x550`.
  - The beam keeps jumping, so phase 6 is closed with a `settle` maneuver: walk left, then release.
  - In the final room it is enough to reach `0x08:2` and press nothing: the ending runs by itself.

### GE-W1 — weapon guard in the final encounter (branch `feature/ge-w1-weapon-aware-progression`)

- The contract in `src/h3_weapon_policy.mjs` is active **only** when a search starts with `RAM[0x72]=5` (visible phase 6). It requires weapon `RAM[0x73]=3` (Shield/Cross).
  - Without that precondition, a forward transition is not a success.
  - `5→4` with a weapon other than 3 is classified `INVALID_WEAPON_ROLLBACK` and pruned.
- `src/h3_explore.mjs` adds the weapon to the cell key, in RAM phase 5 only, so routes with different weapons do not merge.
  - `explore --from` reserves 80% of selections for cells with the shield, when any exist, and 20% for other routes.
  - It ignores rollbacks as goals and reports `GO_PROGRESSION_CANDIDATE` when it sees progress with the right weapon.
- `h3_boss_search.mjs` watches the same address. Deduplication keeps routes with different weapons apart, and ranking is lexicographic: shield first, then the historical score, with no arbitrary bonus. It prunes invalid phase changes (counted in `invalidTransitions`). With the policy active it reports `PROGRESSION_CANDIDATE`, never a certified final room.
- The check uses the weapon seen **in the frame before the phase change**, in case the next scene resets `0x73`. `replay` still gives `MATCH` to verify determinism, and also prints `H3_REPLAY_PHASE_GUARD` with the rollback class. A `MATCH` does not mean the phase was completed.
- **Do not block firing without the shield.** Firing opens pots and produces drops. There is still no reliable RAM signal for the start of the encounter, so the fight against the two bosses cannot be blocked on its own. The policy does not assume a phase 7, and it does not infer the second loop from a change in `0x72`.
- Local validation T5 (2026-11-02):
  - targeted tests **13/13 PASS**, suite `tests/test_h3_*.mjs` **25/25 PASS**, syntax of the four modules **PASS**;
  - on g6, the seed and the candidate gave `MATCH`, and the candidate reported `H3_REPLAY_PHASE_GUARD` with `45814: 5→4`, `weaponAtExit=4` and `INVALID_WEAPON_ROLLBACK`;
  - the commands are in `out/h3/phase6/commands.log`.
  - Closing phase 6 (11/03) is covered in §10.

### GE-W2 — finding the shield (branch `feature/ge-w2-shield-acquisition`)

**Status:** tools and tests ready. GE-W1 stays certified. The shield was picked up at frame 44956 on 11/02, visible phase 6 was completed on 11/03 and the true ending on 11/04; see §10.

1. **Audit the historical route first**, without searching or altering anything:
   ```sh
   bash scripts/h3_run_logged.sh 6 node scripts/h3_weapon_probe.mjs out/h3/boss/search-p5-45828.json 36091
   ```
   It replays from reset on g6 and requires `ramSha` and an empty `H3_POKE`. It saves `out/h3/phase6/weapon-probe-search-p5-45828.json` with every weapon change (`0x73`), phase, X/Y and exact frame. A RAM transition alone does not prove where the item appeared: correlate it with the video or sprites when there are candidates.
2. **Search, and stop at the pickup**, not at the final fight:
   ```sh
   H3_GOAL=weapon H3_RANK=height bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs explore --from out/h3/explore/tape-fase5-completa-36091.json 1 6000 30
   ```
   - `H3_GOAL=weapon` only accepts a seed in RAM phase 5 that does not have weapon 3 yet. The goal is `phase=5 && weapon=3`.
   - It writes `tape-...-weapon.json` with `h3.objective=WEAPON_ACQUIRED`, `weaponPickupFrame`, `goalFrame` and `ramSha`.
   - Before reporting `GO_WEAPON_ACQUIRED`, the explorer replays the new tape from reset and requires `H3_WEAPON_SELF_REPLAY=MATCH` (RAM SHA and weapon). If that fails, it stops without saving a success tape.
   - The weapon checkpoint keeps the P1 inputs of `goalFrame` itself and releases the controls on the next frame. `explore --from` recognizes these checkpoints and keeps their inclusive cut, so the RAM does not diverge.
   - The weapon tape **omits** `h3.transitionFrame`, because getting the shield is not a phase change. `replay MATCH` then checks RAM and signal without requiring the old 0→1 transition.
   - Always require replay `MATCH` from reset before using that tape. **It is not a phase completion.**
3. If the search does not get the shield, keep `*-best.json` and `cells-*.json` for analysis. Do not guess the location, assume a second loop, use `H3_POKE` or promote anything to `fase6`.
4. To continue after the pickup, check that `0x73=3` at `goalFrame`. Then use the new tape as the seed of `explore --from` (without `H3_GOAL=weapon`) or of the beam. A final-room transition stays a `PROGRESSION_CANDIDATE` until video, RAM and code agree.

Pure logic tests: `node --test tests/test_h3_weapon_goal.mjs tests/test_h3_weapon_policy.mjs tests/test_h3_explore.mjs`. The probe needs the g6 bundle, the ROM and the private local tapes. Log every command with `h3_run_logged.sh`.

## 7. Determinism and lab snapshots

- The engine is deterministic: the same tape gives the same RAM. Snapshots (`lab.save`/`restore`) are only used to jump between branches. They never write RAM and never enter the tape. A final tape is validated by replaying it from reset, without restore.
- `explore` is a pure function of seed, iterations, seed tape, bundle and code **as long as it stops on its goal or on `iters`**. The `minutes` limit depends on the clock: if it is what stops the search, the result changes with the machine.
- The beam search and the maneuvers use no randomness. They depend only on their parameters and the tape.
- The explorer was fixed in `b2b9f6a` (`extendMasks`). The S1/S2 tapes are older, so it is not proven that the current code regenerates them byte for byte. Their evidence is the replay `MATCH`.
- A tape with `H3_POKE` is not an input-only tape: `replay` does not apply pokes, so it cannot certify one.

## 8. Known limitations

- `replay` only verifies tapes with `h3.ramSha`. Maneuver tapes and search tapes with `H3_POKE` (`h3:{poke, route, ...}`) give `MISMATCH` by construction; inspect them with `h3_boss_inspect.mjs` or seal them. Search tapes without poke carry `ramSha` since phase 5 and give `MATCH`.
- A beam with `H3_SEED` from an `explore` tape that starts at its `goalFrame` fails with `V3_B1_INPUT_IMPOSSIBLE_TRANSITION`. The release events of that cycle fall outside the base. Start at `goalFrame + 1`.
- Without `h3.transitionFrom`, `replay` checks the **first** transition after frame 1200. That is why the phase 2 tape checks 5890 (0→1). Its 1→2 transition (16566) is in `h3.phaseCompletionFrame` and in the video events, but replay does not check it.
- **Boss life.** `0x0E76` (`BOSS_LIFE`) is only validated for the phase 1 boss. It starts at 5, drops by 1 per hit and does not change without firing; checked with seeds 7 and 11. In later phases it may belong to another object, for example a phase 2 ogre. Therefore:
  - `explore --from` adds it to the cell in every phase;
  - `finish_phase` requires it to be 0;
  - the `bossKill` of `replay` only makes sense in phase 1.
- **Life bytes found later:**
  - Phase 2 guardians: two objects alive at once (`0x0CD0` and `0x0D30`), with lives `0x0CF6` and `0x0D56`, 10 each. In loop 1, `0xc66,0xcf6` were used as a joint life without validation. In loop 2, `H3_GUARD` on the two correct bytes closed the phase in seconds.
  - Phase 5 boss: `0x0D54` (object `0x0D30`). `H3_GOAL=0xd54:0` matches its death.
  - Phase 6 bosses: `0x0D84` and `0x0DB4`.
  - Final boss: `0x0FF6`, 10 when it appears. `h3_verify_ending.mjs` checks it.
  - In loop 1, phases 3, 4 and 5 were completed with `H3_WB=0`, without a boss counter. In phase 5, `0x0E76` stays at 4 the whole stretch. **Phases 3 and 4 still have no validated boss counter.**
- **Beam pruning.** `h3_boss_search.mjs` only prunes on handler, a hit without armor, or lives lost by the end of the segment. A fall into a pit does not change the handler until the life is lost, about 120 frames later in phase 4. With `H3_LAST`, the saved head can therefore be a doomed branch.
  - Check the end of every search tape with a short export or `inspect`, and resume from a frame before the fall.
  - Example: in phase 5, the head at 34470 took a hit without armor at 34600. Repeating the stretch with a later `end` (35670) avoided it. The beam went past 34470, pruned the hit branches and kept the live ones, with no backtracking.
- **Phase clock (3:00).** `0x00AB` is 180 when the phase starts and drops by 1 every 64 frames (seen in loop 2, no gate). Until it has a gate, also watch it on the HUD of short exports. In phase 5 of loop 1, the boss fell with 1:14 left.
- `maneuverOutcome` computes `advance` and `aboveLimit` with `limit=5464`, the H3-F2 geometry. In other stretches those fields mean nothing.
- `h3_finish_phase.mjs` is meant for the first boss. `h3_finalize_phase3.mjs` and `verify_h3_phase3.sh` hardcode the tape, the hashes and frame 16980 of phase 3. From phase 4 on, use `h3_finalize_phase.mjs` and `verify_h3_phase.sh`.
- The phase 2 command sequence **was not logged**. Only the provenance stored in the tape remains ([PROVENANCE.md](PROVENANCE.md)). Reproducing it exactly is pending.
- MAME parity (S3) of the completed phases is pending. Only the S2 stall was compared with MAME (`PASS_ALL_FRAMES_MATCH`).
- Loop 2 searches did not go through `h3_run_logged.sh`, and several explorations stopped on time (phases 2 and 5). The final tape verifies on its own, but rerunning the chain does not give the same bytes. Cutting tapes back to an earlier `goalFrame` (`stamp`) was done with a temporary script that is not in `scripts/`.

## 9. Historical documents

They keep the evidence of each stage in their original document. This README replaces their instructions.

| Document | Status |
| --- | --- |
| [`plan-contenido-h3-h4-2026-10-27.md`](../plan-contenido-h3-h4-2026-10-27.md) | H3→H4 plan. Step 5 (beam, coverage, H3-F2) and the S1/S2 results are historical. Its "next action" is resolved. |
| [`agents/h3-tas-probe-s1-task.md`](../agents/h3-tas-probe-s1-task.md) | S1 GO (10/28). Original explorer design. |
| [`agents/h3-tas-probe-s2-task.md`](../agents/h3-tas-probe-s2-task.md) | S2 STOP (10/28). Found `0x0E76`. Phase 1 was closed later with `h3_finish_phase.mjs`. |
| [`agents/h3-phase2-first-hit-task.md`](../agents/h3-phase2-first-hit-task.md) | H3-F2 closed (10/27). Cause of the hit at X≈5464, with a lab poke. |
| [`agents/h3-phase3-bot-video-handoff.md`](../agents/h3-phase3-bot-video-handoff.md) | Phase 3 assignment, done (11/02). |
| [`agents/h3-phase3-local-agent-kit.md`](../agents/h3-phase3-local-agent-kit.md) | Phase 3 run (P0–P5) and fixed defects. |
| [`agents/h3-phase4-bot-task.md`](../agents/h3-phase4-bot-task.md) | Phase 4 assignment, done (11/02). Evidence in [PROVENANCE.md](PROVENANCE.md). |
| [`agents/h3-phase5-bot-task.md`](../agents/h3-phase5-bot-task.md) | Phase 5 assignment, done (11/02). Evidence in [PROVENANCE.md](PROVENANCE.md). |
| [`agents/ge-w2-phase6-ending-analysis.md`](../agents/ge-w2-phase6-ending-analysis.md) | Phase 6 closing, final room, false and true ending. |
| [`plan-bot-control-jugabilidad-2026-11-01.md`](../plan-bot-control-jugabilidad-2026-11-01.md) | **Current** as the task list (V2–V4) and V1 record. Operational details point here. |

## 10. Verified results

All tapes are input-only, without poke, on bundle g6. How each tape was built (commands, replay signals, gate logs) is in [PROVENANCE.md](PROVENANCE.md).

### Loop 1 (phases 1–6)

On 2026-11-02, `replay` was rerun on the first four tapes (all `MATCH`), and `h3_video.mjs check` at frame 22380 gave `PASS` (RGBA `e9e8fe44…`). No video was regenerated and no search was repeated.

| Visible phase | `0x72` | Transition | Final tape (`out/h3/explore/`) | Tape SHA-256 | RAM at `goalFrame` |
| --- | --- | --- | --- | --- | --- |
| 1 | 0→1 | **5890** | `tape-s2-phase-5950.json` (goal 5950) | `620200d77aabac60c8193a31b4985c5f7dc1399b9c55b39a5ec62e286ec40763` | `d5854d01bee9ad809f4992a3684f1267c9e88b9825a271a3f6f5485b602a24ff` |
| 2 | 1→2 | **16566** | `tape-fase2-completa-16980.json` (goal 16980) | `1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5` | `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004` |
| 3 | 2→3 | **22029** | `tape-fase3-completa-22380.json` (goal 22380) | `9feecfa49b269ad0a0c6cb2e2b96b0e684d1ae7c1f76efef33c3ca96a552b1ed` | `00f267b13bfbb90b500cb493c25005dbeb81bba964ac6a2f5f3f1a682fcc59b5` |
| 4 | 3→4 | **27849** | `tape-fase4-completa-28260.json` (goal 28260) | `ca3be0033ff46cbe28e2b10870b698369505725de352253b7ec183ded62926ac` | `182df0da9c2a2451bf157d088b42c528af6f4771fed00c43ac3984e66c0a61dd` |
| 5 | 4→5 | **35680** | `tape-fase5-completa-36091.json` (goal 36091) | `0c3d5e95ee8fb7e2d2bb272792736f5a3abfdd0669730278686b22de3ed1f96c` | `18190b0a03bacac74a2c81e7b1ad82c0b0256d2fba6ef173057cc7811ae7fd71` |
| 6 | 5→6 | **52080** | `tape-fase6-completa-52900.json` (goal 52900) | `870565cca31902f71dedd7ddffc7f970747b406a71ce4bf7537c17e2486878d0` | `d6fb123bd3b76e2c9a0716aa213507381222786aaa3ce6e0a5ac72c1c0c39629` |

The full replay from reset gives `minLives=3`.

**Phase 6 (11/03).** The first attempt, `search-p5-45828.json`, had weapon `0x73=4` and rolled back `5→4` at 45814. It stays as a diagnostic. The valid route starts from `out/h3/boss/search-p5-53584-b73.json`, which beats both bosses with the shield. The closing is the `settle` cut described in §6.

| Frame | Event |
| --- | --- |
| 52079 | `0x73=3` (shield) the frame before the change |
| 52080 | `0x72: 5→6` |
| 52793 | Final room playable (`0x08=1`, `0x71=2`) |
| 52900 | `goalFrame`: 108 idle frames before the inaction state at 53232 |

The `verify_h3_phase.sh 6` gate also checks `phase6Evidence`: shield before the change, at least 30 continuous playable frames in the room, and no life lost since the change. It recomputes them from the export's `ram` rows. The `settle` macro is still not in `h3_boss_search.mjs`: that tape was built by hand.

**Loop 1 videos** (`out/h3/video/`). Each export was renamed to `faseN.{mp4,json}`; the `video` field of the JSON keeps the original name. The MP4 SHA-256 values match `videoSha256`, and all have `ramVerified=true`.

| Video | Frames | Length | `phase` events | MP4 SHA-256 |
| --- | --- | --- | --- | --- |
| `fase1.mp4` | 1–5950 (5950) | 99.77 s | 0→1 at 5890 | `bc893b3f7b213b8202a23140bcbd1b1e71ce7e583331110d66864e636a2109bc` |
| `fase2.mp4` | 5950–16980 (11031) | 184.97 s | 1→2 at 16566 | `96a8131fbd701d20c70a67f0959c2be85bebe51805e8b4bfcb41995daed30b3d` |
| `fase3.mp4` (export `tape-fase3-completa-22380-9feecfa4-16980-22380`) | 16980–22380 (5401) | 90.56 s | 2→3 at 22029 (only) | `45767e6590d69154d46bbeafdf554d0736d05e78d1b94af49af1c2dd68319e8e` |
| `fase4.mp4` (export `tape-fase4-completa-28260-ca3be003-22380-28260`) | 22380–28260 (5881) | 98.61 s | 3→4 at 27849 (only) | `ededc65212aa29e7ff96b18cbbf9b8e4a0196b1f24e3a20d21f08c3f8f941f87` |
| `fase5.mp4` (export `tape-fase5-completa-36091-0c3d5e95-28260-36091`) | 28260–36091 (7832) | 131.33 s | 4→5 at 35680 (only) | `dc78375a319782ca23179527914c326e253c365ba60083eb4c9b8371d64b1755` |
| `fase6.mp4` (export `tape-fase6-completa-52900-870565cc-36091-52900`) | 36091–52900 (16810) | 281.87 s | 5→6 at 52080 (only); playable from 52793 | `bf4ef1e91a124f3fe5142e21c93531ff99284fe03b23d20da2aff2cf6cc79ce2` |

### Loop 2 and the true ending (11/04)

Tape `out/h3/loop2/l2-ending-96340.json`:

- SHA `98fd8d7fd2cbedc1297f715b0ec81ca38ff55366574bf16d6ab2cbcc032b1987`, 96400 frames, `goalFrame` 96340.
- RAM `4393524905d47c4be186a86f2b3e8b8d70ec7b121c05f9213afaac40184d0511`. Input-only, no poke, g6.
- It starts from the end of loop 1 (`out/h3/phase7/loop1-end-54460.json`, `6→0` at 54091), cut at 54459.
- `node scripts/h3_verify_ending.mjs out/h3/loop2/l2-ending-96340.json` gives **PASS** (`out/h3/phase7/ending-gate.json`).

| Visible phase | `0x72` | Transition | Method that closed the stretch |
| --- | --- | --- | --- |
| 1 | 0→1 | **59128** | `explore --from` (seed 201), stopped on its goal. |
| 2 | 1→2 | **65654** | `explore --from` to the arena; inside it, `H3_GUARD=0xcf6,0xd56` (seed 261, 2–5 s). |
| 3 | 2→3 | **72009** | Chained beam as in loop 1 (width 8, step 120, `WX=1 WS=0 WA=500`) and `keyleft` at 71640. |
| 4 | 3→4 | **78144** | Beam with backtracking, `WY`/`WCY`, steps 60→30→20, and `keyleft` at 77756. |
| 5 | 4→5 | **87009** | Beam with `H3_KEEP_WEAPON=3`; `explore` with `H3_RANK=height` in the tower; beam with `H3_BOSS_LIFE=0xd54` until the boss dies (86652); `keyleft`. |
| 6 | 5→6 | **93103** | Beam with `H3_FOLLOW=out/h3/boss/search-p5-45828.json:50918`, `H3_KEEP_WEAPON=3` and lives `0xd84,0xdb4`; `settle` (left ×3, step 70) at 92738. |
| Final room | 6→0 | **95818** | Beam with `H3_BOSS_LIFE=0xff6 H3_GOAL=0x08:2` from 93823; then no input. |

What the true-ending gate checks, frame by frame:

| Frame | Event |
| --- | --- |
| 93816 | Final room playable: `0x08=1`, `0x7f=1`, `0x71=2` |
| 93856 | Boss spawned: `0xff6=10`, then it only goes down |
| 94521 | Room closed: `0x08: 1→2`, no boss alive |
| 94680 | `0x7f: 1→2`, still in the room |
| 95818 | Single `6→0` exit with `0x7f=0`, `0x71=0`, `0xde=1` (branch `0x7389`, not the loop restart `0x7444`) |
| 96335 | Phase 1 playable again with `0x7f=0` |

- The ending screen shows «CONGRATULATION».
- Lives: 4 at the start of the loop, 6 from 91623 (score bonus), no death. The shield (`0x73=3`) is held in phases 5, 6 and the final room.
- Video: `out/h3/video/l2-ending-96340-98fd8d7f-54091-96340.mp4`. It covers frames 54091–96340 (42250 frames, 708.46 s) with `ramVerified=true`, SHA `c081012a843081494c3987e25215c9834a336c0ec9a351180b8a17bc993813a6`, 68 MB.
- For viewing there are four frame-exact cuts, re-encoded at crf 18: `l2-fases1-2-54091-65653.mp4`, `l2-fases3-4-65654-78143.mp4`, `l2-fases5-6-78144-93102.mp4` and `l2-sala-final-93103-96340.mp4`.

## 11. Maintenance

### Naming convention (required since phase 4)

Artifacts of a completed phase follow the pattern of phases 2 and 3. `N` is the **visible** phase, not the `0x72` value: phase 4 closes with `0x72: 3→4`. File names keep their Spanish form (`fase`, `completa`) because tapes and documents cite them.

| Artifact | Name | Example (phase 3) |
| --- | --- | --- |
| Final tape | `out/h3/explore/tape-faseN-completa-<goalFrame>.json` | `tape-fase3-completa-22380.json` |
| Video | `out/h3/video/faseN.mp4` | `fase3.mp4` |
| Metrics | `out/h3/video/faseN.json` | `fase3.json` |

- `h3_video.mjs export` writes the long name (`<tape>-<sha8>-<start>-<end>`), which the acceptance gate checks. When the gate gives `PASS`, that MP4/JSON pair is renamed to `faseN.{mp4,json}`. The `video` field of the JSON keeps the original name, and `videoSha256` must match the renamed MP4.
- Video `faseN` starts at the last frame of video `fase(N−1)` and ends at the tape's `goalFrame`, which must show the playable start of phase N+1.
- `faseN` is reserved for the complete, accepted phase. Partial stretches keep the long export name. `fase-2-incomplete.{mp4,json}` predates this rule and stays as history.
- Phase 1 also predates it. Its tape is `tape-s2-phase-5950.json` and is not renamed, because the phase 2 tape (`h3.prefix`) and several documents cite that name.
- `h3_finalize_phase.mjs` writes `tape-faseN-completa-<goalFrame>.json`, and `verify_h3_phase.sh` renames to `faseN.{mp4,json}` only after the gate passes. The historical phase 3 scripts keep their interfaces.

### Rules

- Record new results (tapes, hashes, videos) in §10 and their provenance in [PROVENANCE.md](PROVENANCE.md). Record their task status in the bot plan. Future handoffs should point to this README instead of copying instructions.
- If an interface or variable changes, update §3–§4 and the script's header comment in the same commit.
- Write this README and PROVENANCE.md in English.
- Never commit `roms/`, `out/`, `cfg/`, `gng-ghidra/`, tapes, captures or videos. Never modify the engine, AOT, runtime or bundles.
