# Go-Explore H3 — provenance and reproduction

How each verified tape in [README §10](README.md#10-verified-results) was built: commands, replay signals and gate logs. Terms, tools and variables are defined in the [README](README.md).

## Loop 1 replay signals

The final replay signals of the 11/02 session match `h3.signal`:

| Frame | Signal |
| --- | --- |
| 5950 | `phase=1`, X=3373, 3 lives, armor on |
| 16980 | `phase=2`, X=80, Y=574, 4 lives, armor on |
| 22380 | `phase=3`, X=3632, Y=591, scroll=3584, 4 lives, armor on, `firstFatal=null` |
| 28260 | `phase=4`, `cp=0`, X=6736, Y=575, scroll=6656, 4 lives, armor on; in 22380–28260, `minLives=4`, `firstFatal=null` (replay inside the gate) |
| 36091 | `phase=5`, `cp=0`, X=7472, Y=1615, scroll=7424, 5 lives, armor on; in 28260–36091, `minLives=4`, `firstFatal=null` (replay inside the gate) |

At frame 22380 the metrics row shows `inGame=true`, `phase=3`, 4 lives and armor on. The phase 3 handoff records that frame as the playable, visible start of phase 4. ffprobe of `fase3.mp4` (rerun on 11/02): h264, 256×224, 5401 frames, 90.56 s. The `verify_h3_phase3.sh` gate gave `H3_PHASE3_ACCEPTANCE=PASS` when the phase was closed. It was not rerun, because it re-exports the video.

## Phase 1

Commands rebuilt from the tape metadata:

```sh
node scripts/h3_explore.mjs explore 1                                              # S1 → tape-s1-5348-arena.json (f5cbb0c7…, RAM 8ad5a998…), 10,848 iterations
node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s1-5348-arena.json 1 300   # → tape-s2-s1-5528-best.json (19e2108d…, boss at 0)
node scripts/h3_finish_phase.mjs out/h3/explore/tape-s2-s1-5528-best.json         # p1.left 240 frames → tape-s2-phase-5950.json
```

Per README §7, the first two lines may not regenerate the same bytes with the current code.

## Phase 2

The tape records `h3.prefix = tape-s2-phase-5950.json` and `h3.source = out/h3/boss/f2/maneuver-16882-next-stage.json` (`bf7c3dae…`, route `idle,idle`, 120-frame segment). The intermediate search route, the hotel, the canals, the two guardians and the key have no logged commands. Reproducing them is pending (README §8).

## Phase 3

Sequence as run; each step reads the previous output:

```sh
H3_SEED=out/h3/explore/tape-fase2-completa-16980.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 16980 120 17580
H3_SEED=out/h3/boss/search-p2-17580.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 17580 120 19020
H3_SEED=out/h3/boss/search-p2-19020.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 19020 120 20520
H3_SEED=out/h3/boss/search-p2-20460.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WS=0.1 H3_WA=5000 node scripts/h3_boss_search.mjs 2 20460 60 21660
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p2-21660.json 21660 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-21660-keyleft.json 21900 return=right,right,right,right
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-21900-return.json 22140 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase3.mjs out/h3/boss/f2/maneuver-22140-wait4.json 22380
bash scripts/verify_h3_phase3.sh out/h3/explore/tape-fase3-completa-22380.json
```

- The third search ends at `end=20520`, but its final head (`H3_LAST`) is saved as `search-p2-20460.json`, which the fourth one reads. All intermediates are still in `out/h3/boss/`.
- The key appeared on screen after the enemy vanished. The left maneuver picked it up and triggered the automatic transition.

## Phase 4

Sequence logged in `out/h3/phase4/commands.log` (with `H3_*` variables); each step reads the previous output:

```sh
node scripts/h3_explore.mjs replay out/h3/explore/tape-fase3-completa-22380.json                     # MATCH
H3_SEED=out/h3/explore/tape-fase3-completa-22380.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 3 22380 120 23580
H3_SEED=out/h3/boss/search-p3-23460.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=2000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 3 23220 60 24420
H3_SEED=out/h3/boss/search-p3-23700.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=3 H3_WS=0 H3_WA=2000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 23340 60 24540
H3_SEED=out/h3/boss/search-p3-24540.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=1 H3_WS=1 H3_WA=100000 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 24180 60 25380
H3_SEED=out/h3/boss/search-p3-25380.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=1 H3_WS=1 H3_WA=100000 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 25380 60 27780
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p3-27780.json 27480 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27480-keyleft.json 27720 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27720-wait4.json 27960 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27960-wait4.json 28200 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase.mjs 4 out/h3/explore/tape-fase3-completa-22380.json out/h3/boss/f2/maneuver-28200-wait4.json 28260
bash scripts/verify_h3_phase.sh 4 out/h3/explore/tape-fase3-completa-22380.json out/h3/explore/tape-fase4-completa-28260.json
```

- The searches end with exit code 2 (`NOT_ADVANCED`): each one is a stretch, not the transition.
- The first three ran out of live branches or ended in a pit fall (README §8, "Beam pruning"). So each next search resumes a few frames before the end of the previous one. The fifth continues exactly at the end of the fourth (25380).
- The stretch:
  - floating platforms and a rock wall (it needed `H3_WY`);
  - a flying red demon around 24200, shot down with `H3_WS=1` and `H3_WA=100000`;
  - checkpoint `cp` 0→1 at 25138;
  - a lava bridge, and the boss down around 27180.
- «TAKE A KEY FOR COMING IN!» appears. `keyleft` picks up the key at X≈6445, and the transition arrives by itself at 27849 with no more input. Phase 5 is drawn around 28195 and the clock runs from 28220.
- Gate (`out/h3/phase4/gate.log`): `H3_PHASE_PREFIX=PASS`, replay `MATCH` of both tapes, `H3_VIDEO_CHECK=PASS` at 28260 (RGBA `a39323dae179ab555bdb3c9d4c3f506f8f0d7e0f55e77efe81e1b8dd71eea73f`), ffprobe h264 256×224 5881 frames, and `H3_PHASE4_ACCEPTANCE=PASS`. `fase4.mp4` is 13,078,458 bytes.
- The whole sequence was rerun from the seed with the fixed logger. The five stretches, the four maneuvers and the final tape came out byte-identical (file `77b06535…`). Copies of the intermediates are in `out/h3/phase4/steps/`.
- The log also holds diagnostic commands (short exports and `inspect`) and discarded maneuvers (`keyleft3`, `return`). They do not contribute to the tape.
- Frame 22380 of `fase4.mp4` matches the last frame of `fase3.mp4` in RAM metrics. Decoded pixels differ because of the H.264 re-encode (PSNR ≈ 40 dB).

## Phase 5

Sequence logged in `out/h3/phase5/commands.log` (with `H3_*` variables); each step reads the previous output:

```sh
node scripts/h3_explore.mjs replay out/h3/explore/tape-fase4-completa-28260.json                     # MATCH
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-fase4-completa-28260.json 1 4000
H3_SEED=out/h3/explore/tape-s2-s1-29076-best.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=100000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 4 29077 60 29977
H3_SEED=out/h3/boss/search-p4-29977.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=100000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 4 29977 60 31177
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/boss/search-p4-31177.json 1 15000
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s2-s1-32097-best.json 1 6000
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s2-s1-32801-best.json 1 6000
H3_SEED=out/h3/explore/tape-s2-s1-33269-best.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=0 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=60 node scripts/h3_boss_search.mjs 4 33270 60 35670
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p4-35670.json 35310 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35310-keyleft.json 35550 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35550-wait4.json 35790 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35790-wait4.json 36030 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase.mjs 5 out/h3/explore/tape-fase4-completa-28260.json out/h3/boss/f2/maneuver-36030-wait4.json 36091
bash scripts/verify_h3_phase.sh 5 out/h3/explore/tape-fase4-completa-28260.json out/h3/explore/tape-fase5-completa-36091.json
```

- Each search is a stretch, not the transition. Beams end with exit code 2 (`NOT_ADVANCED`), and each `explore` ends with `NOT_REACHED` when `iters` runs out.
- Each `explore` saves its best cell (`-best`). With `H3_RANK=y` that is the highest one, preferring cells that keep the armor. Beams that follow an `explore` start at `goalFrame + 1` (29077 and 33270; README §8).
- The stretch is a vertical tower of floors joined by ladders (Y 575→1615). Scroll `0x58` stays at 6656, so progress is measured in Y.
  - The bottom floor ends in a pit next to the tower (X=7416). The beam with `H3_WX=1` fell in and lost a life.
  - There are blue imps, ogres, Red Arremer and moving platforms. The armor is lost at 29077 in every branch; from then on any hit kills, and the beam prunes it.
  - On floor Y=1135 the next ladder is to the left (X≈6768), and the `maxY` beam stalled. Go-Explore with `H3_RANK=y` found it.
  - The first search 33270→34470 left a doomed head (README §8), so the stretch was repeated up to 35670.
- Boss: the red demon in the top room falls around 35070 (+3000, `H3_WS=1`), with 1:14 on the clock. «TAKE A KEY FOR COMING IN!» appears, and the key lands to the left.
  - `keyleft` takes Arthur to X=7213 (35499) and picks up the key. The armor comes back at 35610, the door opens («BONUS 15000») and the 4→5 transition arrives by itself at **35680**, with only waits.
  - Phase 6 is drawn around 36022 (extra life 4→5 from score), and the clock runs from 36030 (2:59). `goalFrame` 36091 = transition + 411, as in phase 4.
- Gate (`out/h3/phase5/gate.log`): `H3_PHASE_PREFIX=PASS`, replay `MATCH` of both tapes, `H3_VIDEO_CHECK=PASS` at 36091 (RGBA `6957684a55f6922ec762d55f30b01bee56530190dfd579156904a788a27f45b5`), ffprobe h264 256×224 7832 frames (131.33 s), and `H3_PHASE5_ACCEPTANCE=PASS`. `fase5.mp4` is 10,711,553 bytes. The metrics record:
  - `ramVerified=true` and a single `phase` event (4→5 at 35680);
  - the armor, lost at 29077 and recovered at 35610;
  - the extra life (4→5) at 36022, with no death.
- The whole sequence was rerun from the seed with the final code. The 12 intermediate tapes give the same tape SHA, and the final tape (file `8eb95700…`) and `fase5.mp4` came out byte-identical. The gate passed again. Only the metadata of two intermediates changed:
  - `search-p4-29977.json` gains `goalFrame`/`signal`/`ramSha`, because the original predates that change;
  - `tape-s2-s1-29076-best.json` gets `h3.from` = seed back. A diagnostic `explore` launched from it had overwritten it with the same inputs.
- Copies of the regenerated intermediates are in `out/h3/phase5/steps/`, with `SHA256SUMS`.
- The log also holds what does not contribute to the tape:
  - diagnostic commands (short exports and `inspect`);
  - discarded searches: an X beam from 28260 that falls into the pit, a stalled Y beam, an `explore` without `H3_RANK`, and the doomed head at 34470.
- Frame 28260 of `fase5.mp4` matches the last frame of `fase4.mp4` in RAM metrics.

## Phase 6

Final sealing and gate:

```sh
bash scripts/h3_run_logged.sh 6 node scripts/h3_finalize_phase.mjs 6 out/h3/explore/tape-fase5-completa-36091.json out/h3/phase6/settle-left-51900.json 52900
bash scripts/verify_h3_phase.sh 6 out/h3/explore/tape-fase5-completa-36091.json out/h3/explore/tape-fase6-completa-52900.json
```

- `out/h3/boss/search-p5-53584-b73.json` beats both bosses with the shield (`0x73=3`). It then stays in scene `0x08=2` from 51736, because the beam keeps jumping (`0x503=2`) and never meets the `0x74b1` condition.
- The candidate `out/h3/phase6/settle-left-51900.json` cuts `b73` at 51736 and releases P1. It holds `left` from 51736 to 51900, so Arthur reaches X=7724 (`dx=7`, `dy=0`) at 51899. Then it presses nothing.
- Replay data:
  - `0x72: 5→6` at **52080**, with `0x73=3` at 52079;
  - `0x08=0` during the scene;
  - the room is playable from **52793** (`0x08=1`, `0x71=2`);
  - with no input, it goes to `0x08=3`/`0x503=3` (inaction) at 53232, so `goalFrame=52900` leaves 108 idle frames;
  - `0xde` takes the values 0 and 14 in the window; it is only recorded.
- The shield search, the rejected attempt and the final room analysis are in [ge-w2-phase6-ending-analysis.md](../agents/ge-w2-phase6-ending-analysis.md) and `out/h3/phase6/commands.log`.

## Loop 2

There is no `commands.log` (README §8). Each search's log is in `out/h3/loop2/{explore-s*,beam-*}.log`, and the intermediate tapes are in `out/h3/loop2/l2-*.json`, each with its `h3.goalFrame`, `h3.route` and `h3.ramSha`. These commands decided each closing:

```sh
H3_GUARD=0xcf6,0xd56 node scripts/h3_explore.mjs explore --from out/h3/loop2/l2-f2-arena-64380.json 261 Infinity 25   # phase 2 → 65654
C="H3_KEEP_WEAPON=3 H3_SEED=out/h3/loop2/l2-f5-head-86352.json H3_LAST=1 H3_WA=0 H3_WS=1 H3_WX=0 H3_WY=3 H3_BOSS_LIFE=0xd54 H3_WB=1000 H3_GOAL=0xd54:0"
env ${=C} H3_BACKTRACK=8 H3_BACKTRACK_LIMIT=150 H3_STEP=30 H3_WIDTH=24 H3_TAG=l2d node scripts/h3_boss_search.mjs 4 86112 30 88752   # phase 5 boss at 86652
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/loop2/l2-f5-kill-86652.json 86652 keyleft=left,left,left,left   # 4→5 at 87009
C="H3_KEEP_WEAPON=3 H3_FOLLOW=out/h3/boss/search-p5-45828.json:50918 H3_SEED=out/h3/loop2/l2-f6-seed-87356.json H3_LAST=1 H3_WS=0.1 H3_WX=0 H3_WY=0 H3_BOSS_LIFE=0xd84,0xdb4 H3_WB=10000"
env ${=C} H3_WA=3000 H3_BACKTRACK=5 H3_BACKTRACK_LIMIT=150 H3_STEP=20 H3_WIDTH=24 H3_TAG=l2f6a node scripts/h3_boss_search.mjs 5 87356 20 97800   # phase 6 bosses
C="H3_SEED=out/h3/loop2/l2-f6-done-settle.json H3_BOSS_LIFE=0xff6 H3_GOAL=0x08:2 H3_WS=1 H3_WX=-1"
env ${=C} H3_BACKTRACK=5 H3_BACKTRACK_LIMIT=150 H3_WB=10000 H3_WIDTH=24 H3_TAG=l2fb node scripts/h3_boss_search.mjs 6 93823 20 97023   # final room closing
```

`env ${=C}` is the zsh way to split the variable list. Intermediate stretches run without `H3_TAG` overwrote each other between parallel runs. Their exact chain is therefore rebuilt from each tape's metadata, not from the log names.

## Other useful tapes

- `out/h3/explore/tape-live-input-tape-session-1-2724.json`: import `gate=PASS`, RGBA parity at frame 1801, and a life lost at 2173. It completes no phase.
- `out/h3/explore/tape-s2-mamecheck.json` (`7cc074f5…`): MAME parity of the S2 stall.
