# G5-FAST B3 — Native YM2203 events to first non-silent WAV

Date: 2026-10-27. Repo: krukmat/gng-ghidra. Branch: main.

## Goal and evidence

Produce the first demonstrable LAB PCM/WAV from MAME gngb YM2203 register writes (two chips, FM+PSG) via pinned ymfm. This does NOT implement a complete real-time Z80+YM sound engine or prove waveform parity.

Prior Mac gate: Node 54/54 PASS, Python 11/11 PASS, gg2.bin SHA1_MATCH, artifacts private, reset-root static AOT 22 decoded PCs, zero static blockers, SUPPORTED_PREFIX_ONLY. All native audio and gameplay parity gates remain pending.

## Tasks and acceptance

| Task | Implemented | Native status |
| --- | --- | --- |
| B3.T1 Native MAME capture | --capture launches MAME 0.289 gngb with audio_mame_taps.lua and -wavwrite, private JSONL/WAV; strict counters, address maps and reset checks | MAC_PENDING |
| B3.T2 YM chronology | Validates MAME JSONL, rejects malformed/unordered events and mid-stream audio reset; converts to private 12MHz-timed YM TSV | MAC_PENDING |
| B3.T3 First audible WAV | Validates gg2.bin SHA1 and pinned ymfm, compiles YM2203 renderer and emits mono PCM16 62500Hz WAV; rejects silent or invalid PCM | MAC_PENDING |
| B3.T4 Native WAV comparison | Reports reference native WAV duration, peak, RMS, plus UNALIGNED ratio/difference diagnostics, with waveform parity explicitly false | COMPARISON_PREPARED, PARITY_PENDING |

Implemented:
- scripts/audio_b3_checkpoint.py — capture or reuse private tape, ymfm build, event conversion, lab rendering, PCM gate and sanitized JSON.
- tests/test_audio_b3_checkpoint.py — ROM-free unit tests, with synthetic capture/renderer mocks. Actual Mac test execution not yet observed.
Existing MAME Lua taps, YM-to-TSV converter and native ymfm renderer are reused.

## Setup: pinned public ymfm source

ymfm repository: https://github.com/aaronsgiles/ymfm
Pin: 81aec25ccbb98f4873a255f7551ac4dadac59b4a
License: BSD 3-Clause, verified at that commit. Source and native executable must stay under ignored out/audio. Respect the license notice in any redistribution.

From repo root, clone only if the folder does not exist:

    git clone https://github.com/aaronsgiles/ymfm.git out/audio/ymfm
    git -C out/audio/ymfm checkout 81aec25ccbb98f4873a255f7551ac4dadac59b4a

The build script refuses any other HEAD.

## Operator Mac execution

Synchronize main without discarding local commits:

    git fetch origin main
    git merge origin/main

If conflicts occur, stop before the native gate. The local, user-owned sound ROM must already be at out/audio/gg2.bin, as in B2. Do not commit ROM/audio/tape/PCM.

Option A: NEW NATIVE CAPTURE + RENDER (MAME 0.289 installed):

    python3 scripts/audio_b3_checkpoint.py --capture --ymfm-src out/audio/ymfm --duration-ms 5000

Interact with MAME to trigger title or gameplay music/effects, then exit MAME normally to flush its capture. If out/audio/mame-audio-events.jsonl or out/audio/mame-native-audio.wav already exists, --capture deliberately returns MAME_CAPTURE_OUTPUT_ALREADY_EXISTS rather than overwriting historical evidence. Use --tape to replay an existing capture, or rename/archive both outputs within out/audio before making a new capture. Runtime checks pinned MAME 0.289, SHA1 sound ROM, event and WAV validity. MAME native -wavwrite is private.

Option B: ALREADY RECORDED NATIVE TAPE:

    python3 scripts/audio_b3_checkpoint.py --tape out/audio/mame-audio-events.jsonl --ymfm-src out/audio/ymfm --duration-ms 5000

If a private MAME reference WAV is available, append:

    --reference-wav out/audio/mame-native-audio.wav

Do not append reference flag without an existing native reference file. When supplied, metrics are only descriptive because original capture and synthetic render have different time origins and possibly different sample rates.

Success report: GNG_AUDIO_B3_CHECKPOINT_V1, status LAB_NON_SILENT_FROM_MAME_YM_EVENTS_NOT_CERTIFIED. Generated private file: out/audio/b3-first-audio.wav. Return only sanitized stdout JSON and whether that private WAV is audible.

Stops: wrong ROM identity, unpinned MAME or ymfm, tracked output, malformed or unordered native tape, mid-stream YM reset, no YM writes, failed compile, missing source, silent WAV, invalid WAV or unsafe paths. STOP reports never echo path, ROM bytes or samples.

## Limits

- A non-silent WAV shows feasibility of YM event tape -> ymfm -> PCM. It does not certify music fidelity, YM register parity, sample-accurate alignment to the native MAME reference or audio during gameplay.
- Current lab C++ YM renderer lacks timed reset and hardware timer/IRQ accuracy. Reset during YM capture is a STOP, not silent omission.
- A manually supplied tape is marked OPERATOR_PROVIDED_TAPE; its provenance cannot be established purely by validating JSONL.
- Reset-root static AOT covers 22 PC addresses, not full Z80 ISA, IRQ paths or runtime reachability. Sound CPU orchestration is pending.
- No changes to MC6809 engine, bot, core runtime, or GitHub Actions; source privacy is preserved.

Next: after real MAME capture and first non-silent WAV, add aligned native PCM verification and real-time Z80/YM/AudioWorklet scheduling.


## B3 MAC gate — unexpected installed MAME version (2026-10-27)

Operator successfully cloned public ymfm into ignored out/audio/ymfm and checked out the required commit 81aec25ccbb98f4873a255f7551ac4dadac59b4a. The informational detached-HEAD warning is normal; the pinned source is correct.

The first capture command stopped with MAME_VERSION_NOT_PINNED_0289 **before launching the emulation session**, because installed "mame -version" did not identify MAME 0.289. No native audio or PCM has been certified.

The default B3 gate stays strict about MAME **0.289**. To discover the actual installed MAME version locally:

    mame -version

To reach the first non-silent WAV despite another MAME release, an **explicit laboratory-only override** is now available:

    python3 scripts/audio_b3_checkpoint.py --capture --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

This opt-in is only for recording an exploratory native YM register tape and synthesizing a private WAV. It cannot certify MAME waveform parity, audio scheduling parity, or a frozen reference. The safe report includes mame_capture_version, mame_capture_version_pinned, lab_unpinned_mame_used, and all pre-existing parity=false fields. Version strings outside conventional numeric MAME 0.NNN fail closed. The option cannot be used with --tape. ROM identity check, ignored outputs, pinned ymfm hash, typed native-event validation and non-silent WAV checks are unchanged.

A prior operator Mac run reported 54/54 Node PASS and 23 Python tests run with a failure. The probable macOS /var -> /private/var canonical-path mismatch has been fixed, but no post-fix Mac green regression has been received. After adding three new MAME-version tests, the Python suite expects 26 test cases, not a confirmed result.

Before a new capture, synchronize and validate:

    git fetch origin main
    git merge origin/main
    node scripts/audio_fast_checkpoint.mjs

If Python still fails, use full test output (no private ROM or tape needed):

    python3 -m unittest discover -s tests -p 'test_audio_*.py' -v

Do not claim native success until the checkpoint returns LAB_NON_SILENT_FROM_MAME_YM_EVENTS_NOT_CERTIFIED, and the operator confirms the private WAV can actually be heard.


## B3 incident: empty YM trace and guarded re-capture (27 October 2026)

Operator's first native laboratory capture returned STOP/TAPE_NO_YM_EVENTS, so no new B3 PCM was generated. Playing b3-first-audio.wav failed because a valid WAV was not present. A second attempt correctly refused to overwrite the existing native evidence (MAME_CAPTURE_OUTPUT_ALREADY_EXISTS).

The corresponding bus address taps were checked against MAME 0.289 capcom/gng.cpp: Z80 program writes at 0xe000-0xe003 (two YM2203), main CPU sound latch 0x3a00, reset latch 0x3d01, Z80 sound latch read 0xc800. No unsupported address changes were made.

### Diagnose first (private values never exported)

    python3 scripts/audio_b3_checkpoint.py --diagnose --tape out/audio/mame-audio-events.jsonl

This prints sanitized GNG_AUDIO_B3_CAPTURE_DIAG_V1 counters for total bus events, YM writes, main sound commands, Z80 latch reads, reset asserted/released writes and last observed frame. The activity hint is diagnostic only: it does not prove why YM writes are missing. It does not require ROM, MAME, ymfm or a renderer.

If out/audio/mame-native-audio.wav exists, it can be heard locally with:

    afplay out/audio/mame-native-audio.wav

An audible reference with zero recorded YM writes would suggest a tap/capture instrumentation problem; silence does not, by itself, prove what caused the missing activity.

### Retry without overwriting the original evidence

Choose a unique, unused identifier (letters, digits, underscores, dashes, max 32):

    python3 scripts/audio_b3_checkpoint.py --capture --capture-id retry1 --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

The new native output paths become out/audio/mame-audio-events-retry1.jsonl and out/audio/mame-native-audio-retry1.wav. The output path is passed to the existing Lua tap via its GNG_AUDIO_TAP_OUT environment variable. Old captures are retained. Run through title music, or coin/start/movement/attack, before closing MAME normally.

On a further no-YM STOP, the B3 checkpoint now automatically attaches the safe capture_diagnostics object. Share the JSON only, not ROM or audio files.

Still missing: an actual native tape with YM writes, a real non-silent WAV, and eventual waveform parity. No engine, bot or gameplay changes were introduced.


## B3 capture-health instrumentation and failed Python gate (27 October 2026)

Operator checkpoint: Node 54/54 PASS; Python **32 executed, regression STOP**; previous MAME tape contains zero events of *all* tap kinds, not just YM. No evidence establishes whether the emulated game advanced, taps remained live, or Z80 wrote to the audio ports. Do not call this a Z80 or YM bug without further instrumentation.

The native Lua recorder now creates a separate private heartbeat JSON (GNG_AUDIO_MAME_TAP_HEALTH_V1) with only tap-armed state, number of completed emulated frames, per-kind callback counts and suppressed side-effect callback count. A machine-frame notifier and machine-stop notifier update these counts. Neither ROM, RAM, sound commands, YM register values nor waveform data are included. The capture subprocess passes the controlled private output path in GNG_AUDIO_TAP_HEALTH_OUT, while existing event and WAV paths stay protected.

The Python B3 diagnosis now reads this health file only after schema validation. The sanitized diagnosis distinguishes:
- NOT_AVAILABLE_LEGACY_CAPTURE: an earlier tape has no heartbeat sidecar
- TAPS_ARMED_BUT_NO_FRAMES_OBSERVED: Lua installed taps but no emulated frames observed
- FRAMES_ADVANCED_NO_BUS_TAP_CALLBACKS: frames advanced yet no bus events observed; investigate callback lifetime/handler registration and input state, not opcodes yet
- NO_TAP_BUS_EVENTS_OBSERVED: no events and insufficient heartbeat evidence to explain why

The unified fast checkpoint now reports only failing Python unittest method names in python.failing_test_names on STOP_REGRESSION, without exposing tracebacks, local paths or private artifacts. This is a diagnosis aid, not a regression bypass.

First synchronize then run **only**:

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected test count if all new tests are discovered: Node 54, Python **34** (11 prior + 23 B3 tests). Do not run native capture until regression passes. If failing_test_names is empty, run unittest -v for exact traceback; avoid including private ROM or tape content.

Once the Python gate passes, capture a NEW session with a unique name while preserving the previous artifacts:

    python3 scripts/audio_b3_checkpoint.py --capture --capture-id heartbeat1 --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

Start/coin/play/attack and leave MAME running until gameplay or title sound can reasonably occur; exit normally. On missing YM events, the STOP checkpoint includes capture_diagnostics.tap_health. No audio parity is claimed.

An empty older tape can continue to be summarized safely:

    python3 scripts/audio_b3_checkpoint.py --diagnose --tape out/audio/mame-audio-events.jsonl


## B3 native breakthrough: callbacks verified, JSONL serialization at fault

Operator evidence from capture heartbeat1, after running 1653 frames:
- YM2203 write callbacks: **238062**
- Main soundlatch callbacks: **17**
- Sound CPU soundlatch read callbacks: **5322**
- Reset callbacks: **2**
- Serialized JSONL events: **0**

The old NO_BUS_TAP_CALLBACKS hint contradicted the health counters. This definitively proves active native YM sound writes reached the Lua callback, but not that their JSONL rows were saved. The remaining failure is on the recorder serialization/output path, **not absence of Z80 or YM activity**. The emulator's memory-map addresses need no speculative changes.

The preceding full regression had Node 54/54 PASS and Python 34 executed with a single test failure, test_unpinned_mame_lab_capture_is_opt_in_and_provenance_is_explicit. The unit test was too strict: it compared the entire MAME metadata mapping, unaware of added private reference WAV and heartbeat artifact paths. The assertion now checks the intended version/pin plus the expected safe paths. This requires a fresh Mac test run.

The Lua writer now tracks four new allowlisted heartbeat counters:
- written_events: rows successfully handed to the file
- format_errors: exceptions in timestamp or row serialization
- write_errors: failures on output:write
- flush_errors: failures on periodic/final flush

The tap loop handles these errors without publishing private event bytes. The Python diagnostic understands the new counters and retains compatibility with old heartbeat sidecars. It now correctly classifies active callbacks with no JSONL rows, and differentiates format/write failures or a reported tape/path mismatch. Three further tests cover the observed legacy counter pattern, new failure categories and typed heartbeat validation.

First synchronize and validate before another native capture:

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

**Expected only, not yet confirmed**: 54 Node and 37 Python tests. If any fail, pass only the sanitized JSON containing python.failing_test_names. Never skip a failed gate.

Then use an unused capture ID, preserving original and heartbeat1 evidence:

    python3 scripts/audio_b3_checkpoint.py --capture --capture-id heartbeat2 --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

On STOP TAPE_NO_YM_EVENTS, send only capture_diagnostics: it will contain tap_health written_events, format_errors, write_errors and flush_errors. This will pinpoint the stage where recording fails. If successful, open the private out/audio/b3-first-audio.wav locally and report audibility. Audio/parity remains NOT_CERTIFIED until real non-silent WAV is observed.

B3 tape event count cap was increased from 250000 to 1000000 (while retaining the 64MiB file-size cap) after the real 243403 callback total nearly reached the previous bound. No ROM content, music samples or recorded event values have been added to the repository.


## B3 heartbeat2: serialization failure isolated (2026-10-27)

New real operator Mac evidence:
- Fast gate: **54/54 Node and 37/37 Python PASS**; ROM SHA1_MATCH, 22 reset-root compiled static PCs, no static frontier. Audio still NOT_CERTIFIED.
- MAME capture heartbeat2: **2102 frames**, **319462 YM callbacks**, **23 main command writes**, **7124 soundlatch reads**, **2 reset callbacks**.
- **326611 format_errors**, **0 written_events**, **0 write_errors**, **0 flush_errors**, and an empty private JSONL.
- Therefore the Z80/MAME audio bus is active, but the Lua callback failed before file output on every attempt. The exact subexpression that raised was not recorded, so do not assert that any single Lua value was the root cause without the next evidence.

Recorder fix on main:
- Avoid Lua string.format %d for MAME/Sol-bound numeric values in event records; validate bounded integers and format decimal strings via %s, keeping JSONL fields numeric and exact for the short capture window.
- Normalize MAME frame/address/value types defensively and use machine.time:as_ticks(12000000) as preferred tick source. If a tick cannot be converted, a LAB-only as_double fallback is tracked in clock_fallbacks; no sample-accurate parity is claimed.
- Separate new safe heartbeat counters clock_errors, value_errors, clock_fallbacks. The diagnostic differentiates LUA_CLOCK_ACCESS_FAILURES and LUA_NUMERIC_CONVERSION_FAILURES; backwards compatibility with heartbeat2's older health schema is preserved.
- If heartbeat reports missing rows or serialization/write/clock/conversion errors, **STOP NATIVE_TAPE_INCOMPLETE_OR_LOSSY before synthesis**. Native tape provenance and timing accuracy remain unverified until MAME replay.
- New tests cover heartbeat2 counters, old/new schemas and rejection of a lossy native tape. These tests are not a substitute for Mac native validation.

Next operator checkpoint (after syncing; avoid overwriting heartbeat2):

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected if current test discovery is complete: **54 Node and 40 Python tests**, not yet certified on Mac.

When green, record another unique private session:

    python3 scripts/audio_b3_checkpoint.py --capture --capture-id heartbeat3 --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

Interact with MAME (coin 5, start 1, move/shoot) and exit normally. Return ONLY the sanitized GNG_AUDIO_B3_CHECKPOINT_V1 JSON. On native success, privately listen with afplay out/audio/b3-first-audio.wav; confirm actual audible music/effects. Existing heartbeat1 and heartbeat2 evidence must not be deleted or committed.


## B3 heartbeat3 — Numeric conversion isolated (2026-10-27)

Mac operator checkpoint passed **54/54 Node + 40/40 Python tests**, ROM identity SHA1_MATCH, Z80 reset-root static prefix 22 PCs (still not Z80/IRQ parity). The native heartbeat3 recorder saw **1764 frames, 259158 YM register callbacks, 21 main sound commands, 5764 Z80 latch read callbacks, 2 reset callbacks**. All **264945** callbacks failed a numeric field conversion; clock_errors=0, format_errors=0, write_errors=0. The private tape has zero events. **No playable B3 WAV is yet demonstrated**.

MAME Lua 0.289 docs confirm screen.frame_number is read-only and memory tap callbacks receive absolute offset, data and mask. The specific failing field was not observed in heartbeat3, so the fix must remain evidence-gated. B3 now:
- Counts separate frame_errors, address_errors and data_errors in the private heartbeat. It also counts frame_fallbacks when screen.frame_number cannot be read as a decimal integer and the Lua frame notifier counter is substituted. This fallback is LAB-only: native frame alignment is not certified.
- Never invents an MMIO address or bus data value if the MAME callback value cannot be validated. Such events remain a STOP.
- Validates each new heartbeat field before surfacing numeric counters, while accepting older health formats.
- Adds ROM-free tests for per-field diagnostic classification and rejecting malformed health counters.

Next operator checkpoint, preserving heartbeat1, heartbeat2, and heartbeat3:

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected (not yet observed): **54/54 Node and 42/42 Python**. Once PASS:

    python3 scripts/audio_b3_checkpoint.py --capture --capture-id heartbeat4 --lab-allow-unpinned-mame --ymfm-src out/audio/ymfm --duration-ms 5000

Trigger audio in MAME, exit normally, return ONLY the sanitized GNG_AUDIO_B3_CHECKPOINT_V1 JSON. The new frame/address/data counters distinguish whether any remaining problem is a UI frame wrapper or unconvertible MMIO values. Never share private native tapes, WAV, extracted ROMs, or captured register values.


## B3 heartbeat4: native events finally written, chronology still blocked (27 October 2026)

Operator Mac result: Node **54/54 PASS**, Python **42/42 PASS**, ROM SHA1_MATCH, static 22-PC reset prefix still NOT Z80 parity. A new MAME session named heartbeat4 now returned STOP/TAPE_BAD_CHRONOLOGY rather than TAPE_NO_YM_EVENTS. This establishes that the JSONL recorder is no longer uniformly empty, but it does **not** establish the specific chronology fault or audio fidelity.

The validator deliberately requires strict increments of JSONL seq and non-decreasing 12MHz ticks and frame numbers. A violated assertion could be due to a sequence gap, reversed native tick, backwards reported frame, or a negative value. No field values from heartbeat4 were supplied, so none may be presumed to be the cause.

New read-only audited diagnosis: the existing private JSONL is sufficient; **do not run MAME again yet**.

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs
    python3 scripts/audio_b3_checkpoint.py --diagnose --tape out/audio/mame-audio-events-heartbeat4.jsonl

Expected after adding four ROM-free unit tests: Node 54 and Python **46 tests**, pending Mac confirmation. The second command prints GNG_AUDIO_B3_CAPTURE_DIAG_V1 with nested GNG_AUDIO_B3_CHRONOLOGY_DIAG_V1. It contains only counters for bad_sequence (gaps vs duplicate/backwards), tick_regressions, frame_regressions, negative_clock_or_frame, invalid_chronology_types, the first bad row **index** and tap_health safe counters; **no timestamps, byte values, PC or addresses** are printed.

Any chronology failure remains STOP_CHRONOLOGY_NOT_RENDERABLE, and it will not generate a WAV. Investigate based on counters:
- frame_regressions only: check mixed MAME frame_number/heartbeat fallback and screen reset; do not reinterpret an unaligned frame field as certified.
- tick_regressions: inspect native clock source and callbacks scheduling offline; do not reorder events and falsely claim parity.
- bad_sequence: inspect row loss/insertion/tap lifecycle and heartbeat written_events; do not renumber blindly.

Do not share the actual tape, private WAV, sound ROM or raw event timestamps. Native YM parity remains PENDING.
