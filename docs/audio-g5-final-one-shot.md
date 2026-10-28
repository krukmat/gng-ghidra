# G5 — Final one-shot decision gate: authentic Z80-generated sound

> **ARCHIVED / HISTORICAL — 2026-10-28.** This page describes the earlier investigation and contains obsolete pending commands and test totals. The G5 task was **closed by explicit operator decision**, with real-game audible audio accepted and 120 s PCM continuity PASS, but **not** with complete T3.7 technical certification (reset STOP; A/V estimate 132 ms vs 100 ms target; full Z80/IRQ parity not certified). **Do not restart this one-shot plan**. The authoritative final record is [G5 audio recovery closure](agents/g5-audio-recovery-task.md#cierre-definitivo-por-decisión-del-operador--2026-10-28).

## Why this replaces incremental B4.T2/B4.T3 checkpoints

The operator verified 115/115 Node and 77/77 Python tests, and confirmed
194/194 **observed native MAME PC addresses** were present in the compiled
static Z80 AOT PC set. That is PC presence, NOT Z80 register/IRQ parity.
Earlier lab run reached T=12,502, was in IM1, and emitted zero YM events.
The captured native first YM write was at about T=898,884 after release,
whereas its first post-reset main sound command was much later,
T=19,782,194. A 12,540T run cannot decide the sound question.

Stop speculative opcode expansion and partial handoffs. Produce one
end-to-end proof or one explicit blocking cause.

## One operator command

After updating `main`:

```bash
node scripts/audio_live_final.mjs
```

All inputs are already available **only on the operator's Mac**:

- `out/audio/gg2.bin`, verified by known SHA1.
- `out/audio/z80-native-roots-b4trace1.json`, the observed-PC seed set.
- `out/audio/z80-native-controls-heartbeat4-t3b3.json`, private MAME
  **sound-command inputs** with the reset-relative master clock.
- `out/audio/ym2203_lab`, previously built against pinned ymfm using
  `scripts/audio_ym_native_build.sh`. If missing, the final command
  produces an explicit renderer-missing STOP code.

The script automatically runs the full regression first, then advances
the real private ROM via precompiled Z80 AOT and the sound-bus scheduler,
until **6,000,000 T-states after the first real post-reset MAME sound command**
(approximately 25,782,194 T-states / 8.6 seconds for the existing
`heartbeat4` capture, bounded by 36 million T-states and 5 million
instruction steps). The execution remains one continuous Z80 CPU/bus session,
chunked for bounded CPU and memory usage; there is **no fabricated music
command or YM register playback**. Future commands beyond the target are not
injected early. It uses the
pre-release latch if one was observed. The runner counts newly executed
Z80 `YM2203_WRITE` events through the sound-bus observer.

If YM writes are emitted by the running Z80, the script creates
a **private** intermediate TSV containing **only those newly generated
writes** and invokes the existing pinned dual-ymfm renderer to produce a
private mono 62.5 kHz 16-bit WAV. The intermediate event TSV is deleted
after rendering. The WAV is validated as actual non-silent PCM; one
sanitized JSON is printed with counts, first failure (if any), and private
WAV basename.

**No private ROM, PC traces, raw register writes, generated AOT source, or
captured MAME YM output is published or pasted into GitHub.** The native
YM event tape is categorically not used for this rendering; MAME's only
inputs are board sound commands and their timing.

### One gate, strict interpretation

| Outcome | Meaning | Decision |
|---|---|---|
| `Z80_TO_DUAL_YM_TO_PCM_LAB_PASS_NOT_LIVE_GAME` | In-process real private Z80 instructions emitted YM writes; pinned dual YM2203 produced non-silent PCM | Accept **end-to-end sound generation laboratory proof**; do **one final browser sync integration** afterwards |
| `PARTIAL_Z80_TO_PCM_RUNTIME_STOP` | Some Z80-generated YM output and PCM occurred, but CPU runtime stopped before target | Keep partial evidence, **do not** certify completion |
| `STOP / AUDIO_FINAL_Z80_NO_YM_WRITES` | Z80 advanced for the full one-second window but produced zero YM writes | Stop broad work; identify **one** native parity mismatch, not new speculative opcode batches |
| `STOP / AUDIO_FINAL_Z80_RUNTIME_STOP` | AOT/runtime/IRQ/bus stopped before audio started | Stop and name code from the nested execution summary |
| `STOP / AUDIO_FINAL_YMFM_RENDERER_MISSING` | Local pinned dual-YM renderer absent | Restore already proven local renderer; no change to sound CPU |
| `STOP / AUDIO_FINAL_PCM_SILENT` | YM events exist but don't synthesize nonzero PCM | Focus exclusively on YM reset, chip register sequence or calibration |
| `STOP / AUDIO_FINAL_REGRESSION_GATE_STOP` | Fast regression failed | Fail closed; do not claim audio |

This is **the final B4 proof gate**, not a claim that gameplay already
has live sound. Even a non-silent private WAV is an **offline output of a
real-time-generated sound-chip command source**; the browser
AudioWorklet is not wired into the MC6809/Z80/dual-YM pipeline, 240Hz
IRQ/HOLD_LINE phase is not native-certified, and CPU register parity is
not proven. The user does **not** need to repeat full MAME captures,
scanner frontier loops or successive 12,500T probes for this gate.

## Definition of full playable sound

Full audio DONE still requires these three independent conditions:
1. Live MC6809 board sound events drive the sound latch and reset line
   for the same running gameplay session.
2. A validated continuous Z80 IRQ/sound generator feeds dual YM2203 PCM
   in correct game-time order (not a captured YM tape or pre-rendered WAV).
3. The browser AudioWorklet consumes those PCM frames while the game runs,
   with audible, repeatable synchrony and no hidden sample underruns.

The final one-shot may clear the difficult Z80→YM→PCM dependency; it
**does not falsely mark conditions 1–3 as done**.

## 2026-10-28: real one-shot result — YM activity but silent PCM

The operator ran the real private end-to-end command:

- Regression: **120 Node + 78 Python PASS**.
- **323,564** Z80 AOT instructions, **3,000,002** T-states, runtime `LAB_ADVANCE_OK`.
- Periodic IRQ: **239 requested, 169 IM1 acknowledged** in the current unverified lab model.
- **7,440 freshly generated YM writes**, split 3,720 per chip. The event stream came directly from running the private Z80 ROM, **not** recorded MAME YM events.
- The one-second probe was **too short to test native sound commands**: first post-reset command occurs ~19.78m T-states (~6.59s). The final command is now extended beyond that event, and reports actual sound-latch reads after it; only then can a silence verdict describe an input-stimulated sound program.
- Pinned dual-YM renderer generated **63,187** PCM frames, **all zero**. Status `STOP/AUDIO_FINAL_PCM_SILENT`. Therefore **the goal has NOT been met**. Valid YM bus writes do not prove that meaningful tone/volume/key-on register operations occurred.
- This result makes random static opcode expansion inappropriate. Audio engine and bot remain untouched.

### Targeted final diagnosis, not another exploration cycle

The existing `node scripts/audio_live_final.mjs` command now also produces **two strictly count-only YM register activity profiles**:
1. `ymRegisterHealth`: classify the **actual 7,440+ Z80-originating** address/data port operations into FM key-on/off, frequency writes, operator programming, PSG volume and mixer counts (separately by chip). No raw YM address-selected bytes, values, or event sequences are printed.
2. `nativeYmComparison`: **read-only** parse of the already captured MAME 0.288 `heartbeat4` native YM tape within the **same first 3,000,000 Z80 T-states after reset release**. This is solely an aggregate reference to diagnose missing channel activation. It is **NOT** fed to the YM renderer or replayed in the audio output, and no native trace/ROM is uploaded. If the reference isn't locally available or fails parsing, the generator still runs; the comparison is explicitly marked unavailable.

The diagnostic distinguishes:
- 7,440 address operations without real FM key-on or nonzero PSG volume ⇒ **silent source programming**, Z80 execution/IRQ/boot/sound-latch semantics to investigate.
- Z80 produces key-ons/nonzero PSG gain, but renderer remains identically zero ⇒ **YM state, mixer, reset or output path** to isolate using the already proven B3 renderer.
- Native and lab first-second register family counts differ strongly ⇒ **missing behavioral parity**, NOT an invitation to fabricate YM writes or expand random opcodes.

New `src/gngb_ym_register_health.mjs` and `src/gngb_ym_native_baseline.mjs`. New ROM-free tests `tests/test_gngb_ym_register_health.mjs` and `tests/test_gngb_ym_native_baseline.mjs` added to the same gate (3+2). Isolated JS YM health tests **3/3 PASS**; separate mocked native baseline window validation PASS. Complete Mac gate expected **125 Node + 78 Python**, pending operator run.

**One final operator command**, using the existing local private evidence:

    git pull --ff-only
    node scripts/audio_live_final.mjs

Return **only its JSON**. The evidence will identify the silent **register activation** boundary; no need to rerun MAME captures, repeat scanner batches or pass any `out/audio` files. If still silent without a clear source-vs-renderer diagnosis, report **BLOCKED: native Z80/IRQ and YM output parity unproven** and stop declaring progress. Do not claim browser sound without a continuous MC6809/Z80/dual YM PCM/AudioWorklet path.

### Closing change — extended authentic-input window (2026-10-28)

The previous final command conclusively proved execution and transport but
reported a 1s **silent output** with 7,440 YM writes. We identified a
fundamental test-design limitation: it stopped at 3 million T-states whereas
the first **captured** main-to-sound command occurred 19,782,194 T-states
after release. The source therefore was not exercised by a genuine live
post-reset command in that one-second window.

The command now extends the **same** Z80 CPU/bus execution until six million
T-states after that first authentic command, with a hard 36m-T / 5m-step
budget, chunked internal `advanceTo` calls, 200k bounded live YM events,
and 30s maximum WAV. It never replays the native YM tape. `onLatchRead`
records only aggregated real Z80 C800-read counts (including reads after
the first command), not sound-command values; PCM must still be non-silent
to pass. The native YM comparison uses the **same extended reset-relative
window** for aggregate register activation statistics.

One ROM-free synthetic delayed-command test executes past the previous
3m-T cutoff and verifies the **newly delivered** sound command is polled
by Z80 and produces new YM register writes. Isolated runtime tests
**15/15 PASS** across sound probe and native control suites; full operator
regression still awaits the single final local run.

**Run:** `git pull --ff-only && node scripts/audio_live_final.mjs`.
If the output remains `AUDIO_FINAL_PCM_SILENT`, the returned same-window
native-vs-generated register activation and post-command latch-read counts
are the terminal investigation result, not permission for more speculative
static opcode or frame-sized iteration. The PCM audio of *running gameplay*
remains uncoupled from MC6809 and browser AudioWorklet until explicitly
integrated and audibly validated.

## 2026-10-28 — Authenticated post-command blocker: runtime indirect ROM AOT

**Latest operator one-shot results** (not a pass):
- Mac regression **126/126 Node + 78/78 Python**, ROM hash verified.
- Z80 stopped after **2,362,941 steps / T=19,787,763** with
  `AUDIO_Z80_IRQ_UNCOMPILED_PC`, **one native captured sound command
  applied**, and **one genuine C800 latch read after that command**.
- MAME first YM write relative to reset was at **T=898,884**; our
  compiled Z80 first YM write was at **T=898,887**. This small
  initial offset is encouraging but **NOT** full parity.
- Z80 before runtime STOP emitted **66,532 YM port writes**, 33,266
  per chip, but **zero FM key-ons, zero nonzero PSG volumes and silent PCM**.
  Native MAME in the compared window recorded **63 FM key-ons**, 146 FM
  frequency writes and 240 FM operator writes, which never appeared in
  the lab prefix. No captured native YM writes were used as audio source.
- Thus the immediate blocker is **the first control-flow path actually
  taken after a genuine sound command**, not the renderer gain or missing
  command stimulus. Static 64-root AOT cannot enumerate computed JP(HL)
  targets or all return addresses. Its 194/194 observed PC overlap
  only applies to the earlier native sample and does not certify this
  new branch.

**Implemented fix** (no engine/bot changes):
- The isolated sound scheduler accepts an optional fail-closed
  `resolveUncompiledPc(pc,blocks)` callback; its default behavior is
  unchanged. It is called ONLY when the executing CPU actually reaches
  an unmapped AOT block.
- The Node sound probe can JIT exactly **one supported ROM instruction
  at that runtime PC**, using `compileZ80Prefix(rom,{entry:pc,limit:1})`.
  Generated function stays exclusively in process memory; it is
  attached to the current compiled block Map, never saved, uploaded
  or printed. No generic unknown-opcode interpreter is added.
- Strict bounds: must lie within **0x0000..0x7fff**; no execution
  invented for RAM/IO, max **4096 dynamic resolutions**, unsupported
  opcodes fail closed with a privacy-safe uppercase family label
  rather than bytes, PC addresses or JS source.
- Existing full-session native command timing, 36m T-state / 5m step
  bounds, YM synthesizer and sound bus are unchanged.
- New tests cover indirect JP(HL) with genuine dynamic YM output, actual
  late captured sound command followed by an indirect routine,
  unsupported instruction family, and an outside-ROM target.
  **19/19 isolated sound-probe + native-control tests PASS**.
- The final CLI now reports `runtime_rom_blocks_resolved`,
  `runtime_resolution_attempts`,
  `runtime_first_unsupported_family`. If the runtime stops and PCM is
  silent, the top-level reason is
  `AUDIO_FINAL_RUNTIME_STOP_AND_PCM_SILENT` and the nested
  `execution.reason` identifies the real instruction/IRQ/bus stop,
  instead of masking it with a generic silence-only diagnosis.

### Definitive next operator check

Run **one** command after updating main:

    git pull --ff-only
    node scripts/audio_live_final.mjs

Expected full regression **130 Node + 78 Python**, still awaiting Mac
verification. Return its one sanitized JSON only. If real Z80 processing
now reaches FM key-ons and creates nonzero PCM, the *private lab*
Z80→YM→PCM dependency is cleared. That does **not** establish engine
MC6809→sound Z80 scheduling, browser AudioWorklet delivery, or native
IRQ/CPU timing parity; those remain explicit release requirements.

If a dynamic opcode is truly unsupported, the report supplies the
family needed to make a bounded, evidence-based decision. Do not
interpret an unsupported opcode as license to fabricate sound or
replay MAME YM tape, and do not claim live gameplay audio.
