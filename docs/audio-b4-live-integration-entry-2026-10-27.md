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

## B4.T2-B1 — Dynamic-root scanner and first Z80 opcode-family batch (2026-10-27)

Verified operator evidence after recovering the saved MAME 0.288 native trace:
- Python/Node fast gate **68/68 Python, 59/59 Node PASS**; private ROM SHA1_MATCH.
- `b4trace1`: 28,345 standard MAME Z80 disassembly PC lines parsed into **194 distinct ROM PCs** (0 outside sound ROM); 64 most frequent native-backed PC roots selected under the existing seed cap. Note: `source_cpu_independently_verified=false`, `mame_loaded_same_rom_verified=false`, and trace loops may be condensed. Do not equate observed PCs to instruction-correctness or complete runtime coverage.
- Multi-root Z80 scan returned `PARTIAL_UNCERTIFIED`, `static_decoded_pcs=63`, **30 blocked static frontiers**; families: `Z80_OTHER` 22, `DD_IX_PREFIX` 5, `LD_R_R` 1, `ALU_REGISTER` 1, `RET_CONDITIONAL` 1. These are aggregated static frontiers, not a percentage of dynamic trace coverage.
- All original raw debugger traces, ROM and native-backed roots remain private in ignored `out/audio/`.

**Implementation B4.T2-B1 on `main`:**
- `src/gngb_z80_static_codegen.mjs` now statically compiles unprefixed `LD r,r'` including `(HL)` memory operands (4/7 T-states), **except HALT** (still fail-closed).
- Compiles `ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,r` including `(HL)`, preserving Z80 arithmetic S/Z/H/PV/N/C and undocumented F3/F5 behavior (CP uses operand F3/F5); uses 4/7 T-states.
- Compiles `RET cc` for all NZ/Z/NC/C/PO/PE/P/M conditions (5T not taken / 11T taken), using the stack for an actual return address; never fabricates a compile-time target.
- Refines diagnostic families previously lumped under `Z80_OTHER`: `ADD_HL_RR`, `LD_ACCUMULATOR_INDIRECT`, `ROTATE_ACCUMULATOR`, `JP_INDIRECT`, `LD_SP_HL`. These classifications **are not implementations**.
- New ROM-free tests `tests/test_gngb_z80_live_families.mjs`, added to `scripts/audio_fast_checkpoint.mjs`: six tests cover register/memory moves, arithmetic and undocumented flags, every conditional return and branch, HALT rejection and family classifications.
- The updated JavaScript compiler and emitted instructions were exercised against **27 synthetic execution cases** in an isolated V8 check and passed. This is not an independent native MAME differential or the complete regression on operator Mac.
- No edits to the MC6809 game engine, bot, audio MAME capture, browser AudioWorklet or private ROM code.

**Next Mac checkpoint**, no new MAME capture necessary:

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected **65 Node, 68 Python tests**, pending Mac validation. Once PASS, use the previously captured `b4trace1` roots and a NEW private report filename:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b2.json

Do not send the private roots/report file or any raw trace. Return only the sanitized scanner JSON, especially `families` and `first_frontiers`. A `PARTIAL_UNCERTIFIED` stop/exit 2 remains expected until all native-backed frontiers are addressed.

**Then B4.T2-B2**: implement only the remaining observed families; `DD_IX_PREFIX` demands indexed-register and displacement semantics with native validation, not a blanket substitution. Do not mark B4.T2 or runtime audio completed until dynamic Z80/240Hz IRQ scheduling and live YM events pass their own gates.

## B4.T2-B2 — BC/DE accumulator indirect + immediate ALU + typed DD frontier

**Operator checkpoint at entry:** Node **65/65**, Python **68/68**, SHA1_MATCH. With 64 native-profiled roots from the existing MAME 0.288 `b4trace1`, scanner reports `PARTIAL_UNCERTIFIED`: **67 static decoded PCs**, **28 unsupported frontiers** (22 `LD_ACCUMULATOR_INDIRECT`, 5 `DD_IX_PREFIX`, 1 `ALU_IMMEDIATE`). The frontier PCs are statically derived from executed roots, **not all 28 individually proven executed PCs**.

New compiler changes, keeping generated source private:
- All four unprefixed `LD (BC),A`, `LD A,(BC)`, `LD (DE),A`, `LD A,(DE)` with 7 T-states, bus accesses through the existing sound bus, flags unaffected.
- All eight unprefixed `ADD/ADC/SUB/SBC/AND/XOR/OR/CP A,n` families, 7 T-states, 2-byte instructions, with arithmetic carry/overflow/half-carry and undocumented F3/F5 flags matching corresponding register-operand semantics.
- DD/FD prefixes **remain unsupported for execution**. Offline compiler now reads only the following byte to assign an enum-like `indexed_instruction` family (e.g. `INDEX_LD_RR_IMMEDIATE`, `INDEX_DISPLACEMENT_LOAD`, `INDEX_BIT_ROTATE_DISPLACEMENT`), without leaking operand bytes to GitHub or stdout.
- `src/gngb_audio_frontier_report.mjs` explicitly validates that `indexed_instruction` is a safe uppercase tag and belongs only to `DD_IX_PREFIX`/`FD_IY_PREFIX`. Original DD report test updated.
- `tests/test_gngb_z80_indirect_immediate.mjs` contains **five ROM-free tests** covering all four BC/DE accesses, all eight immediate ALU opcodes, flag edge cases, full classifier family matrix, and malicious tag rejection. Included in `scripts/audio_fast_checkpoint.mjs`. A local isolated V8 validation against the GitHub source verified **43 synthetic cases**, no failures. Not a substitute for operator Node suite or MAME differential.
- No main MC6809 engine, bot, private ROM artifacts, MAME trace, or browser audio producer changed.

### Next operator checkpoint, NO MAME recapture

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected **70 Node + 68 Python**, not yet confirmed on operator Mac. Once PASS:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b3.json

The report may remain `PARTIAL_UNCERTIFIED` and return exit 2; this is an expected *coverage* STOP, not a regression. Return its stdout JSON with `families`, `first_frontiers` and `static_decoded_pcs`. The DD `indexed_instruction` values specify what IX handling is actually needed in **B4.T2-B3**, rather than implementing the entire index-prefix ISA speculatively.

**Critical remaining dependencies:** Z80 IRQ servicing at 240 Hz, EI/HALT semantics, sound ROM dynamic branches, reset/latch parity, real-time ymfm/WASM PCM producer, AudioWorklet synchronization. Neither an empty *static* frontier report nor a 15-second recognizable **offline** WAV certifies live game audio.

## B4.T2-B3 — Six frontier breakthrough and regression correction (2026-10-27)

**Operator Mac checkpoint:** B4.T2-B2 returned `STOP_REGRESSION` with **69/70 Node, 68/68 Python**, so B2 was not accepted despite the native-backed scan advancing from 67 decoded PCs / 28 frontiers to **92 decoded PCs / 6 frontiers**. The existing 64-root scan reported 5 DD_IX_PREFIX blockers, all explicitly classified `INDEX_LD_RR_IMMEDIATE`, plus 1 `RST` blocker at PC 287. No native timing/audio parity is implied.

**Regression diagnosis:** prior Node test `B1 multiple independent roots expose multiple true frontiers` expected the old three-field DD blocker object. The previously added, privacy-safe indexed diagnostic now includes `indexed_instruction`, so the strict deep equality was stale. Updated it; also retained the other privacy regression fixtures using unsupported **DD22** rather than the now implemented DD21. This is the source-level identified mismatch; complete Mac gate remains pending.

**Implementation:**
- `src/gngb_z80_static_codegen.mjs` statically compiles *only* `DD 21 nn nn` / `FD 21 nn nn` as `LD IX/IY,nn`, preserving all flags and other state, 4 bytes and 14 T-states, with ROM-boundary guards. All other DD/FD indexed instructions still fail closed under their recognized safe class names.
- Compiles all eight unprefixed `RST` opcodes into fixed 0x00..0x38 call vectors, pushing address of the following instruction onto the stack (high byte then low byte), 11 T-states, stack accesses charged at +8 / +11 T from instruction start, leaving flags intact. AOT statically follows the vector and fall-through but does NOT claim native IRQ parity.
- `tests/test_gngb_z80_rst_ix_immediate.mjs` adds 5 ROM-free tests for IX/IY register/timing, truncated ROM rejection, eight RST targets and stack/clock activity, stack wrap, and strict unsupported DD behavior. Existing exact DD blocker fixture and frontier-report fixture updated to **DD22** where a blocker is intended; DD21 is now compiled. The tests are integrated into the existing `scripts/audio_fast_checkpoint.mjs`.
- Independent V8 synthetic smoke verified 11 DD/FD and RST emitted-code scenarios with zero failures. This is not the full Node suite or native CPU parity.
- No edits to gameplay engine, bot, recorder, private ROM, browser playback, or GitHub Actions.

### Next operator Mac gate

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

**Expected 75 Node / 68 Python** (previous 70 + five new Node tests), pending operator confirmation. Only if PASS, run a NEW private report filename against the previously recovered 64 native-backed PC roots, no new MAME capture:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b4.json

The output may report further newly reachable unsupported instruction families and remain PARTIAL_UNCERTIFIED; that is a coverage gap to triage, not a reason to mark live sound done. If the 64-root static frontier becomes empty, do NOT infer full Z80 coverage: full native executed PC census is **194**, while the scanner seeds only 64. Remaining native trace coverage, IRQ servicing, sound reset/latch, YM event stream from *running JS* and live PCM are independent gates.

**B4.T2-B3 source implementation is prepared, not yet operator-validated.**

## B4.T2-B4 — Native-backed indexed displacement load, ADD HL,rr, POP rr/AF

**Mac-verified entry state:** Node 75/75, Python 68/68, sound ROM local SHA1_MATCH. Existing `b4trace1` 64-root scanner now reports `PARTIAL_UNCERTIFIED` with 102 statically compiled PCs, eight new blockers:
- 5 `DD_IX_PREFIX / INDEX_DISPLACEMENT_LOAD` (at distinct static frontiers);
- 2 `ADD_HL_RR`;
- 1 `POP_RR`.

The increase from 6 to 8 blockers is expected because supported instructions exposed new static edges. None of these values certifies live Z80 execution or waveform parity. The 194 observed MAME PC addresses are still a broader evidence set than the selected 64 roots.

**Implementation committed on main:**
1. `src/gngb_z80_static_codegen.mjs`: offline compiles all seven legal `DD/FD LD r,(IX/IY+d)` subforms, excluding 0x76/HALT; displacement is signed 8-bit, effective address wraps 16 bits, reads sound bus at 19 T, register destination includes the *ordinary* H/L fields (not IXH/IXL), flags unaffected. Full ROM-boundary checks; remaining indexed load/store/ALU/bit/stack forms still fail closed.
2. Same compiler now supports `ADD HL,BC/DE/HL/SP`, 11 T, preserving S/Z/PV, setting H/C from true 16-bit carry and half-carry, undocumented F3/F5 from high result byte, clearing N.
3. Supports `POP BC/DE/HL/AF`, 10 T, little-endian sound bus stack reads with SP wrapping, correct AF A+F split, no fabricated register or stack data.
4. Kept old unsupported DD tests on `INDEX_DISPLACEMENT_STORE` and other still unsupported opcode categories rather than incorrectly requiring newly compiled `LD r,(IX+d)` to fail.
5. `tests/test_gngb_z80_index_add_pop.mjs`: six new ROM-free instruction tests, included in `scripts/audio_fast_checkpoint.mjs`. Separate isolated JS/V8 smoke of the actual generated source passed **27 indexed-load, ADD HL and POP cases**; complete Mac regression still pending.

No main MC6809 engine, bot, audio tape, private ROM, MAME debugger capture, YM synthesis, or browser playback was altered.

### Immediate operator checkpoint

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

**Expected Node 81/81, Python 68/68** (unverified until Mac run). If passed, reuse native-backed roots with a fresh private output:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b5.json

Return only the sanitized JSON report, particularly family counts and indexed subfamily tags. A `PARTIAL_UNCERTIFIED` scanner exit 2 remains an expected coverage gate and must not be confused with test failure. Further supported instructions can expose more blockers, particularly during IRQ/latch processing. **Even zero static blockers from 64 roots cannot certify all 194 executed PCs or full sound hardware timing.** Live audio still requires dynamic Z80 scheduling/IRQ, YM PCM generation, and AudioWorklet integration.

## B4.T2-B5 — JP conditional, Z80 EX family, HALT boundary and CB subfamily diagnosis

**Operator entry checkpoint:** full Mac regression **81/81 Node PASS**, **68/68 Python PASS**, SHA1_MATCH. With the same private MAME 0.288 native-PC roots (`b4trace1`) the static scanner reports **186 compiled PCs** and **6 blocked frontiers**: 3 `JP_CONDITIONAL`, 1 `EXCHANGE`, 1 `HALT`, 1 `CB_BIT_ROTATE_PREFIX`. These are *static* code paths reached from 64 execution-backed roots, not full 194-PC dynamic coverage or sound CPU timing parity. Raw native MAME trace and AOT compiled output remain private.

**Implemented in `src/gngb_z80_static_codegen.mjs`:**
- All eight `JP cc,nn` (NZ/Z/NC/C/PO/PE/P/M) using compiler-resolved direct address and both CFG edges, 10 T whether taken or not; flags preserved.
- `EX DE,HL`, `EX AF,AF'`, `EXX`, and `EX (SP),HL`. All except `EX (SP),HL` take 4 T; stack-exchange uses 19 T and reads both stack bytes before writing previous HL, handling SP=FFFF wrap. Alternate register banks require explicit initialized *A/F'* or *BC/DE/HL'* fields; missing banks fail closed instead of injecting undefined into CPU state. Full 16-bit main/alternate state initialization remains a future scheduler responsibility.
- `HALT` sets `halted=true`, advances PC to the post-HALT address and charges 4 T for the initial HALT instruction. `stepZ80AotAtBoundary` rejects subsequent CPU execution while halted with `AUDIO_Z80_IRQ_HALTED_AWAITING_SERVICE`. This is a **safety boundary**, not an implementation of halted wait cycles, real IRQ/NMI acceptance, post-IRQ resume or 240Hz scheduling. `canAcceptZ80MaskableIrq` remains a readiness predicate only.
- `CB` instruction execution remains **unsupported**. Newly added `classifyZ80CbInstruction` recognizes `CB_ROTATE_SHIFT`, `CB_BIT_TEST`, `CB_RESET_BIT`, `CB_SET_BIT` by second-byte family and publishes only uppercase, validated tags `cb_instruction` in `src/gngb_audio_frontier_report.mjs`. No CB operands or ROM bytes are shared.
- Legacy HALT test updated from 'unsupported opcode' to the new distinct `halted` AOT state. Existing exact CB frontier expectations updated for privacy-safe diagnostic metadata.

**Synthetic tests:** new `tests/test_gngb_z80_jp_exchange_halt_cb.mjs` has **9 ROM-free Node tests**, covering all JP flags/outcomes, register exchanges, stack exchange and rollover, reject missing alternate banks, HALT stop boundary, EI+HALT eligibility timing, CB categorization and metadata allowlist. Added to the single Mac regression gate. A separate isolated V8 check on the actual emitted compiler code verified 71 targeted paths with zero failures (before the additional shadow-state guard; the guard has its own fixture). No full Mac test execution or native differential completed for this commit.

**Next checkpoint on operator Mac, NO new MAME capture:**

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected **90 Node** and **68 Python**, *not yet verified by operator*. If PASS, reuse existing native roots and choose a NEW private report name:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b6.json

`PARTIAL_UNCERTIFIED` and exit 2 are expected if newly exposed opcode families remain. Return **only** JSON stdout, especially `families`, `first_frontiers`, and `cb_instruction` if present. Do not send trace, ROM, generated code or any private files.

**Follow-up B4.T2-B6 priority:** Implement only the real observed CB subfamily and other new scanner blockers; separately extend native-backed coverage beyond the first 64/194 observed PC seeds. Full hardware audio remains explicitly blocked on a real Z80 instruction/IRQ scheduler, YM2203 real-time synthesis and AudioWorklet integration. No main MC6809 engine or bot was modified.

## B4.T2-B6 — 275-PC root scan, focused Z80 instruction batch

**Mac operator entry checkpoint:** Node **90/90 PASS**, Python **68/68 PASS**, SHA1_MATCH. The private native-backed `b4trace1` 64-root scanner currently compiles **275 static PCs** with eight reported frontiers: `PUSH_RR` (2), `DD_IX_PREFIX/INDEX_DISPLACEMENT_STORE` (2), `JP_INDIRECT` (1), `CALL_CONDITIONAL` (1), `CB_BIT_ROTATE_PREFIX/CB_ROTATE_SHIFT` (1), and `OUTSIDE_SOUND_ROM` at 62729 (1). The outside-ROM address is 0xF509; no evidence yet that it is actually executed (static CFG is an overapproximation). An empty default RESET_VECTOR_ONLY scan remains only 22 PCs, not full CPU coverage.

**B4.T2-B6 source implementation on main:**
- `PUSH BC/DE/HL/AF`: push high then low byte through sound bus at +8/+11 T with wrapping SP, total 11T, no flag mutation.
- All eight `CALL cc,nn` (NZ/Z/NC/C/PO/PE/P/M), two CFG successors. Conditional non-taken=10T with no stack write; taken=17T with call return address pushed on stack at +11/+14 T, preserving flags.
- `JP (HL)`: 4T dynamic-PC assignment, **no invented static target**. Requires a separately validated runtime dispatch for the resulting PC, not proof it is ROM code.
- `DD/FD LD (IX/IY+d),r`: seven register sources with signed displacement, 16-bit effective address wrap, 19T, flags unchanged. No support for other indexed families.
- All eight `CB ROTATE/SHIFT` groups, both register and `(HL)`: RLC, RRC, RL, RR, SLA, SRA, undocumented SLL, SRL. Register=8T; memory read at +8, write at +15, total=15T. Z80 S/Z/PV/F3/F5/C flags recomputed; H and N reset. `CB BIT/RES/SET` remain **unsupported**, with fail-closed blocker and privacy-safe `cb_instruction` classification.
- Static `OUTSIDE_SOUND_ROM` blockers now carry optional **`source_pc`**, the originating compiled ROM PC, whitelisted in the diagnostic layer exclusively for the outside-ROM reason. This is **not** ROM data, a branch-taken claim, evidence of RAM execution, or evidence that 0xF509 is valid Z80 memory.

**Test migration:** prior tests used `CB 00` as an intentionally unsupported sentinel. Since CB rotate now compiles, these synthetic test terminators were changed to `CB 40` (BIT B; still unsupported). No private ROM test input changed. New `tests/test_gngb_z80_b6_frontiers.mjs` has **eight** ROM-free tests: PUSH x4, CALL cc x8 with both outcomes, JP(HL) dynamic target, DD/FD indexed stores, CB x8 register and (HL) flags/clocks, continued unsupported CB classes, and strictly validated static predecessor of synthetic 0xF509. Included in existing `scripts/audio_fast_checkpoint.mjs`. A separate local isolated V8 execution of the actual AOT emitted source passed **85 focused instruction cases**, plus independent report/provenance smoke. Full Node/Python regression remains to be executed by the operator on Mac.

### Next operator gate — no MAME recapture or engine/bot changes

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected **98 Node + 68 Python** (unverified pending Mac run). If PASS, scan SAME 64 private native-backed roots but NEW output:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b7.json

Return only sanitized stdout. A `PARTIAL_UNCERTIFIED` / code 2 may remain appropriate; look for `source_pc` if `OUTSIDE_SOUND_ROM` is still present, and identify any newly exposed instruction families.

**Critical separation:** B4.T2 static block availability is not proof of dynamic Z80 scheduler, 240Hz IRQ acknowledgment, Z80 timing parity, same loaded ROM in MAME, or game audio. Full dynamic executed PC census in `b4trace1` contains **194 unique ROM PCs**, while the current scanner used only 64 selected entry roots; this coverage gap must be closed (by private multi-batch scan/differential checks) before claiming broadly reachable native code. Never reinterpret 0xF509 as a valid ROM instruction or guess code bytes there. Engine and bot untouched.

## B4.T2-B7 — Fix four false regressions and audit native-vs-static PC overlap (2026-10-27)

**Operator checkpoint at entry:** B6 resulted `STOP_REGRESSION`: **94/98 Node**, **68/68 Python**, ROM not checked by checkpoint because it stopped early. The native-root scan independently verified local SHA1_MATCH and returned `PARTIAL_UNCERTIFIED`, **3609 static compiled PCs** and **11 static blockers**: 3 CB BIT, 3 outside sound ROM, 2 indexed instructions, 1 LD_DIRECT, 1 accumulator rotate, 1 FD stack/jump.

**Source-backed 4-test diagnosis and fix:**
- A prior JR conditional out-of-ROM test expected only `{pc,reason}`; the compiler intentionally now supplies privacy-safe `source_pc` (first predecessor PC). Updated the test to require it.
- Three old test fixtures used the DD/FD `INDEX_DISPLACEMENT_STORE` subfamily (DD 70) as an unsupported sentinel, but it became supported in B6. Changed these fixtures to still-unsupported `INDEX_DISPLACEMENT_UPDATE` (DD/FD 36), preserving fail-closed tests instead of weakening assertions.
- A standalone execution of 79 ROM-free Node tests of compiler/frontiers/boundary from the current GitHub sources now reports **79/79 PASS**. This is NOT the operator's full 98-test Node suite or 68-test Python suite. Mac rerun is required.

**Key architectural observation:** 3609 statically explored PCs exceeds the **194 distinct PCs actually observed** in the saved, private MAME 0.288 audio CPU trace; broad overapproximation is plausible as branches explore unexecuted paths or noncode regions. Do not interpret compiled static PCs as native execution evidence or convert 3609 into a gameplay completion percentage. The outside-ROM frontiers remain PC-only static edges:
- `0x8000` from `0x7fff` — possible sequential fallthrough beyond ROM image;
- `0xee09` from `0x0152`;
- `0xf509` from `0x014e`.
None has been proven executed or valid code outside the ROM. Do not invent code or silently broaden the Z80 bus map.

**New B7 native/static overlap audit:**
- `scripts/audio_z80_scan.mjs` now adds `static_visited_pcs` to the **private JSON report only**. Console stdout remains the same sanitized family/count summary, and no ROM bytes or instruction bodies are serialized.
- `scripts/audio_z80_coverage.py`: validates the original ROM hash and closed debugger trace from existing capture ID; safely reads the private static report; validates that root PCs were native-backed (except default 0); and computes distinct-PC set intersection. Console output contains **counts only**: native ROM PCs, static compiled PCs, intersection, observed native PCs missing from AOT, and compiled static PCs never observed. Flags explicitly deny CPU/IRQ parity and game audio.
- `tests/test_audio_z80_coverage.py`: 3 ROM-free Python unittest cases for intersection arithmetic, bogus/non-native roots and forged private metadata, and private-path / empty trace refusal.
- This audit does NOT require another MAME capture, cannot independently establish same ROM loaded by emulator, and cannot certify instruction/IRQ timing. It is a decision gate for whether to stop expanding speculative static paths and begin validating sound CPU scheduler/IRQ with the native-backed subset.

### Next Mac commands

    git fetch origin main
    git merge --no-edit origin/main
    node scripts/audio_fast_checkpoint.mjs

Expected **98 Node**, **71 Python** (68+3), still unverified on Mac. Only after PASS:

    node scripts/audio_z80_scan.mjs --roots out/audio/z80-native-roots-b4trace1.json --out out/audio/z80-frontier-b4trace1-b8.json

`PARTIAL_UNCERTIFIED`/exit 2 is expected. The newly generated private b8 report includes the exact static compiled PC census. Compare with the previously captured MAME executed PCs, reading **only from local ignored out/audio/**:

    python3 scripts/audio_z80_coverage.py --id b4trace1 --report z80-frontier-b4trace1-b8.json

Return only the sanitized stdout JSON of the fast checkpoint, scanner and coverage helper. Never paste raw MAME trace, PC root files, private reports, ROM or generated JS.

**Next decision:** if most native-observed PCs are covered despite many static-only PCs, prioritize real Z80 scheduler, IRQ 240Hz / HALT + latch/reset validation, and stop broad speculative opcode implementation. If native-observed PCs are missing, privately isolate those verified gaps before scheduler promotion. B4 remains unverified for actual browser gameplay audio.
