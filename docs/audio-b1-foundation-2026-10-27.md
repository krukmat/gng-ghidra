# G5 / B-AUDIO-1 — Sound foundation (2026-10-27)

**Branch:** `main` · **Goal:** authentic Ghosts 'n Goblins audio; never MP3 substitution.
**Status:** code prepared, **ROM-free tests not independently executed in this connector-only session**; native validation on Mac **PENDING**. No sound synthesis exists yet.

## Contract (MAME gng.cpp; gngb set)

- Main AOT bus write `0x3a00` → 8-bit `soundlatch`; sound CPU reads at `0xc800`. Generic latch stores the latest byte. Do **not** model a hardware FIFO from the observer log.
- LS259 main latch `0x3d01`, Q1: **0 asserts** Z80 reset and resets both YM2203; **1 releases**. The observer reports logical output changes, while native tap records bus writes.
- Z80 address map: ROM `0x0000..0x7fff`; RAM `0xc000..0xc7ff`; YM1 `0xe000..0xe001`; YM2 `0xe002..0xe003`; periodic Z80 IRQ 240 Hz.
- Z80 clock 3 MHz; two YM2203 at 1.5 MHz, each routed FM+PSG to mono.
- `gngb` audio ROM `gg2.bin`: **0x8000 bytes, CRC32 615f5b6f, SHA-1 7ef9ec5c2072e21c787a6bbf700033f50c759c1d**. Shared with parent `gng`; personal ROM stays private.
- Reference: [MAME gng.cpp](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp). Freeze actual emulator binary version, game revision, input tape, reset/DIPs and ROM hashes for parity; do not silently mix 0.288 and 0.289.

## Scope and task status

| Task | Implementation/evidence | State |
|---|---|---|
| A1.T1 ROM identity | `scripts/audio_rom_preflight.py` with size+CRC32+SHA-1 and clone/parent ZIP selection; synthetic Python tests | PREPARED; needs Mac archive to PASS |
| A1.T2 hardware map | Above contract and `src/gngb_audio_contract.mjs` | CONTRACT_WRITTEN; native clock/IRQ alignment not verified |
| A1.T3 timed sound bus | Opt-in `onAudioEvent` on `createBoard`. `SOUNDLATCH_WRITE` on every write; `AUDIO_RESET_LINE` on Q1 transitions; absolute main-AOT cycle, frame and PC. Existing CPU/video path unchanged when observer absent. `tests/test_gngb_audio_events.mjs` | IMPLEMENTED; ROM-free tests await execution |
| A1.T4 MAME differential | `scripts/audio_mame_taps.lua` watches soundlatch write, reset write, Z80 latch read, YM2203 register writes; `scripts/audio_events_compare.py` compares ordered latch commands only, with fail-closed conditions | IMPLEMENTED LAB INFRA; real aligned capture and differential pending |

**IMPORTANT:** The MAME trace uses **12-MHz master ticks**; JS events use **main-AOT absolute CPU cycles**. Do not treat ticks, raw frames, or wall-clock timestamps as equivalent before calibrating a common input/reset epoch. The parity utility intentionally verifies only ordered latch values, not native scheduling or Z80/YM behavior. MAME Lua tap APIs are documented, but the script itself has not run in native MAME here.

## Local Mac checkpoint (no ROM or traces committed)

```bash
git checkout main && git pull --ff-only
node --test tests/test_gngb_audio_events.mjs
python3 -m unittest discover -s tests -p 'test_audio_*.py' -v
python3 scripts/audio_rom_preflight.py --rom roms/gngb.zip --shared roms/gng.zip
mkdir -p out/audio
```

**ROM ZIP note:** MAME commonly resolves files from clone/parent archives; if your local parent archive has another path, pass it with `--shared`. No identifying bytes, hashes of personal files, sound samples or traces should be posted publicly.

For a native reference capture, using the same ROM revision and previously verified input tape (or an exactly documented manual sequence):

```bash
GNG_AUDIO_TAP_OUT=out/audio/mame-audio-events.jsonl \
  mame gngb -rompath roms -autoboot_script scripts/audio_mame_taps.lua -autoboot_delay 0
```

MAME must run the corresponding inputs; `-autoboot_script` instrumentation alone does not reproduce a tape, and a late autoboot can miss startup commands. Keep the Lua recorder alive until MAME exits, then inspect the JSONL privately. **No native PASS until these requirements are satisfied.**

To generate the JS counterpart, attach a *streaming sink to the existing local runner's* `createBoard(...,{...,onAudioEvent})` callback (do **not** add an unbounded in-memory array for long sessions):

```js
import fs from 'node:fs';
const stream=fs.createWriteStream('out/audio/js-audio-events.jsonl',{flags:'w'});
const onAudioEvent=e=>stream.write(JSON.stringify(e)+'\n');
// Pass onAudioEvent into the existing createBoard options of that local run.
// Close stream once the runner has finished.
```

Then compare only after confirming **same ROM, same game scenario and same input chronology**:

```bash
python3 scripts/audio_events_compare.py \
  --js out/audio/js-audio-events.jsonl \
  --mame out/audio/mame-audio-events.jsonl
```

Expected best-case status is `MATCHED_LATCH_COMMANDS_ONLY` — *not* audio parity. Any mismatch, no commands, invalid capture or identity mismatch is a STOP, not a reason to inject synthetic events.

## Next block B-AUDIO-2 (must not alter bot or main CPU instruction semantics)

- **A2.T1** Real Mac `gg2.bin` identity PASS, same-ROM capture of title/Coin/Start/shot, stable MAME version/input chronology.
- **A2.T2** Export Z80 control-flow and ROM provenance offline, choose an auditable Z80 AOT strategy and test with an independent laboratory oracle (ROM remains local).
- **A2.T3** Independent YM2203 core evaluation (ymfm / WASM), register-level test fixtures and explicit license/accuracy review.
- **A2.T4** Z80 → FM/PSG register event tape and first synthesized PCM; compare against MAME on the same scenario.
- **A2.T5** Real-time AudioWorklet integration, buffering, mute/focus/reset and measured latency, after A2.T4.

**GO for B-AUDIO-1:** ROM identity, tests, native capture and bus command correspondence are independently verified on Mac with a recorded common scenario. Do not infer G5 or H5 completion from ROM-free checks.
