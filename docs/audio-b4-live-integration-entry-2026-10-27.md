# G5 — B4: live game audio integration, first executable boundary (2026-10-27)

Repo: `krukmat/gng-ghidra` · branch: `main`.

## Decision

**B3 is functionally accepted.** The operator confirmed that a 15-second WAV synthesized by pinned ymfm from the private MAME `heartbeat4` YM register stream is recognizably the introduction of Ghosts 'n Goblins. This is real *offline* audio, NOT runtime sound from the JS game.

Do not continue optimizing recorded-WAV playback or disguise it as integrated audio. The product goal of B4 is **main MC6809 execution → sound latch/reset → live Z80 execution with 240 Hz IRQ → two YM2203 chips → PCM buffer → browser AudioWorklet**, with temporal diagnostics and MAME differential validation.

## Existing components (verified from repository source, not runtime certified)

| Component | Implementation | Live sound status |
|---|---|---|
| Main 6809 sound/reset writes | `src/gngb_runtime.mjs` optional `onAudioEvent` observer, 0x3a00/LS259 0x3d01 | Existing main event instrumentation, no Z80 |
| Z80 board memory and clocks | `src/gngb_z80_sound_bus.mjs` with ROM/RAM/latch/reset/YM ports, 12 MHz tick mapping | Isolated bus, no execution |
| Main → Z80 control bridge | `src/gngb_audio_main_z80_bridge.mjs` **B4.T1 new**, consumes observer values, forwards to sound bus, reports state | Control routing prepared; no PCM/IRQ |
| Z80 AOT | `src/gngb_z80_static_codegen.mjs` and `scripts/audio_z80_build.mjs`; 22 PCs from reset vector only | **Critical blocker:** not enough dynamic coverage, no sound CPU scheduler |
| Z80 interrupt | `src/gngb_z80_irq_boundary.mjs` maskable IRQ *eligibility* helper | No acknowledgement, vectors, periodic scheduler or native parity |
| Dual YM2203 | Native laboratory `src/audio_ym2203_lab.cpp` + pinned `ymfm` | Only offline replay of captured register writes |
| PCM transport | `gngb_audio_pcm_queue.mjs`, `gngb_audio_pcm_processor.mjs`, `gngb_audio_worklet_sink.mjs` | Transport only; no real-time PCM producer and no WebAudio integration |

B3 metrics: 312533 captured native bus events; 305698 YM port writes; 15000ms WAV at 62500Hz mono, 543583 nonzero samples, peak 23115, RMS 3261.574, clipping 0. The user audibly recognized the intro. Global inter-CPU event ticks had 11 inversions, accepted **only** in gated laboratory replay. No waveform timing parity or game runtime integration was proven.

## B4 tasks, dependencies and hard gates

| Task | Dependencies | Acceptance | Status |
|---|---|---|---|
| **B4.T1** Connect main event stream to Z80 bus | Existing `onAudioEvent`, sound bus | ROM-free tests of latch semantics, reset polarity, 12MHz mapping, invalid events; **zero invented YM writes** | **CODE IMPLEMENTED / TESTS MAC PENDING** |
| **B4.T2** Reachable Z80 AOT coverage | Private `gg2.bin`; native-backed roots incl. IRQ; offline compiler | Dynamic control paths exercised on Mac with traceable PC coverage, unsupported frontiers fail closed, no RAM ROM code exported | **BLOCKED BY NATIVE COVERAGE EVIDENCE** |
| **B4.T3** Z80 scheduler and 240Hz IRQ/reset | T1+T2, boundary eligibility helper | Correct Z80 T-states, IRQ request/service, EI delay, HALT wake, reset and sound latch; differential event tests against MAME | **NOT IMPLEMENTED** |
| **B4.T4** Real-time dual YM synthesis and PCM | T3 and pinned YMFM | Native register events from *running JS Z80*, PCM16→WebAudio Float32, underflow handling, reset chip semantics, continuous waveform | **NOT IMPLEMENTED** |
| **B4.T5** Browser integration and A/V sync | T4 and existing PCM worklet | Audio heard while playing; user gesture resumes AudioContext; measured drift/underruns; MAME oracle comparison | **NOT IMPLEMENTED** |

**No missing gate can be replaced with a recording:** captured MAME tapes remain a *differential oracle*, not the browser's gameplay audio source. Never substitute an MP3/recorded intro as “real-time audio.”

## B4.T1 completed in source (Mac regression pending)

- New `src/gngb_audio_main_z80_bridge.mjs` exports `createGngbMainZ80Bridge(soundRom, options)`. The bridge's `onAudioEvent` can be passed unchanged as the `createBoard(...,{onAudioEvent})` observer. No changes to `src/gngb_runtime.mjs` or bot.
- Forwards sound latch and reset controls to the already implemented `createZ80SoundBus`, retaining last-byte latch semantics and safe cycle→master-tick conversion.
- Exposes `bus` explicitly for a *future* sound CPU executor and a read-only `snapshot()`. Snapshot *always* declares `schedulerRunning=false`, `pcmGenerated=false`, `browserAudioWorking=false`, `nativeTimingParityVerified=false`.
- New ROM-free tests in `tests/test_gngb_audio_main_z80_bridge.mjs` check main clock conversion, reset, sound latch, rejection of malformed events and **no automatic YM writes**.
- Included these tests in the existing `scripts/audio_fast_checkpoint.mjs` regression. No private ROM or game resources in git.

### Immediate Mac checkpoint

From the repo root, keeping all local commits:

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected: previous Node **54** plus **5** new test cases = **59**, Python **59** unchanged (not yet Mac-confirmed on this commit). Expected status remains `PASS_REGRESSION_STATIC_SCAN_Z80_NOT_CERTIFIED` with `audio_working=false`.

### Next development subblock: B4.T2 — Z80 dynamic reachable paths

1. Define a privacy-safe native Z80 **executed-PC count/profile** (no opcode bytes or ROM dumps), distinguishing reset and timer-IRQ entries under a named operator scenario.
2. Use confirmed native-backed entry roots to expand the offline Z80 AOT frontier. Do not assume that lack of a static frontier from the reset-only path means sound CPU coverage.
3. Add ROM-free instruction/IRQ scheduler fixtures for branches, EI delay, masks, 240Hz IRQ and register/stack preservation. Only promote successful differential native paths into sound runtime.
4. **Stop** if unsupported opcodes or RAM-executed paths remain uncovered; request a sanitized gap/family report, not private ROMs.

This is the **critical path to live gameplay sound**. The preexisting B3 WAV can remain the stable reference for later differential comparisons. No additional MAME recording is required merely to validate the T1 bridge.

Privacy: keep `gg2.bin`, MAME event traces, native PCM/WAV, ROM-derived Z80 AOT exports and compiled YMFM binary inside ignored `out/audio/`. Never publish instruction bytes or game audio. Avoid touching main engine semantics, bot and GitHub Actions.

## B4.T2-A — Native-backed executed-PC collection (2026-10-27)

**Input checkpoint:** B4.T1 59/59 Node + 59/59 Python PASS; ROM SHA1_MATCH. Z80 AOT currently reaches only 22 PCs under RESET_VECTOR_ONLY, and dynamic Z80 execution/IRQ scheduling remains unimplemented.

**Implementation now on main:** `scripts/audio_z80_native_trace.lua` configures MAME's debugger `trace` for only `audiocpu`, with `tracelog "AUDIOPC=%04X",pc` markers. It requires `-debug`, writes a fully private raw debugger trace and a counters-only heartbeat, and stops tracing after a bounded number of frames. `scripts/audio_z80_native_pc.py` provides opt-in capture, validates private trace closure, SHA1 sound ROM, and parses only marked PC addresses into a private `GNG_AUDIO_Z80_OPERATOR_PCS_V1` root file (up to 64 roots) compatible with `scripts/audio_z80_scan.mjs`. These are **executed PC observations**, not proof of complete sound ROM instruction reachability, ISA correctness or IRQ parity.

Official MAME API contract: [Debugger trace syntax](https://docs.mamedev.org/debugger/execution.html#trace) and [Lua debugger interface](https://docs.mamedev.org/luascript/ref-debugger.html). The raw trace contains disassembly and possibly ROM instruction values; **never share, paste or commit it**. Trace/roots/health exist only under ignored `out/audio/`. Refuse existing IDs or oversized (128MiB) raw traces. MAME version other than 0.289 requires explicit laboratory opt-in. No changes to main engine or bot.

### Next local checkpoint

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected 59 Node + **64 Python** (adds five synthetic PC profiler tests), not yet confirmed on Mac. Run a **new** debugger capture (not heartbeat4):

    python3 scripts/audio_z80_native_pc.py --capture --id b4trace1 --frame-limit 360 --lab-allow-unpinned-mame

MAME starts with the debugger; the Lua script attempts to issue `go`. If still halted, F5 resumes. You can trigger title/coin/start sound and quit MAME normally (Esc). The trace stops after 360 *emulated* frames, irrespective of wall time. MAME debugger APIs may vary on your locally installed version: a native failure is a STOP, not a certified PC trace.

After `NATIVE_TRACE_CAPTURED_PRIVATE_PROFILE_PENDING`:

    python3 scripts/audio_z80_native_pc.py --profile --id b4trace1

After `PRIVATE_NATIVE_TRACE_PROFILE_NOT_CPU_PARITY`, compile frontiers from *observed* PC roots:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1.json

The scanner may exit 2 for `PARTIAL_UNCERTIFIED` while still printing a safe JSON of grouped Z80 blocker families: this is expected and defines actual next compiler work. Never publish private trace, ROM, codegen, WAV or profiler root JSON. Only return the three sanitized stdout checkpoint JSONs.

B4.T2-A is **IMPLEMENTED / NATIVE VALIDATION PENDING**. Subsequent B4.T2-B develops only instruction families proven necessary by the dynamic-backed roots; B4.T3 implements scheduler/240Hz IRQ, B4.T4 live YMFM PCM producer, B4.T5 Worklet + gameplay A/V sync.

## B4.T2-A checkpoint — MAME 0.288 markerless trace, recovery before recapture

Mac operator: Node **59/59**, Python **64/64**, ROM SHA1_MATCH. Command `audio_z80_native_pc.py --capture --id b4trace1 --frame-limit 360 --lab-allow-unpinned-mame` returned `NATIVE_TRACE_CAPTURED_PRIVATE_PROFILE_PENDING` with installed MAME **0.288**. Subsequently the profile returned `STOP/TRACE_MARKER_NOT_SEEN`, and the roots scanner returned `AUDIO_SCAN_INPUT_OR_RUNTIME_STOP` because the roots file did not exist. Neither result demonstrates any Z80 PC coverage, and `trace_armed` is a Lua-script status, **not independent evidence that MAME traced sound instructions**.

**Diagnosis from MAME 0.288 source, without inspecting the private file remotely:** MAME 0.288 `src/emu/debug/debugcpu.cpp` `device_debug::tracer::update` emits default instruction trace lines in the shape `"%s: %s\\n"` (PC string, colon, disassembly) regardless of whether custom debugger `tracelog` action markers appear. The old profiler assumed **only** `AUDIOPC=hhhh` marker lines, so it could reject a valid default MAME tracer file.

**Fix on main:** a bounded read-only `--inspect` mode classifies the existing private b4trace1 file and outputs **only counts**, closed heartbeat and presence of 4-hex-PC default MAME trace lines. `--profile` prefers `AUDIOPC` markers if present, otherwise recovers PCs from anchored, canonical MAME standard disassembly headers `hhhh: instruction`; it never scans arbitrary hexadecimal tokens or exports instruction strings. Recovered roots are limited to the private `gg2.bin` ROM region, with the usual SHA1, size, path and no-overwrite gates. It explicitly declares `source_cpu_independently_verified=false` and no native Z80 parity.

Four more tests cover default PC-line recovery, inspector no writes, marker-vs-default precedence and rejecting ambiguous hex text.

**Next commands, WITHOUT rerunning MAME:**

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs
    python3 scripts/audio_z80_native_pc.py --inspect --id b4trace1

Expected tests: Node **59**, Python **68** (previous 64 + 4), not yet Mac validated. If `status=MAME_STANDARD_DISASSEMBLY_PC_LINES_RECOVERABLE` or `MARKED_PC_LINES_AVAILABLE`, run:

    python3 scripts/audio_z80_native_pc.py --profile --id b4trace1

Only if profile `status=PRIVATE_NATIVE_TRACE_PROFILE_NOT_CPU_PARITY` generates private roots, run:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1.json

If `NO_RECOGNIZED_PC_LINES` (possibly zero-byte trace), STOP and share **only inspector JSON**. The next task would then instrument whether debugger `trace` returned an error and whether MAME's audiocpu actually executed with tracing enabled. Do not guess PC roots, alter files in `out/audio/`, or send raw tracer text.
