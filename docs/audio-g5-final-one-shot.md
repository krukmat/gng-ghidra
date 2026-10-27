# G5 — Final one-shot decision gate: authentic Z80-generated sound

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
for at most **3 million Z80 T-states** (one sound-CPU second). The run
applies only actual captured **main-CPU sound-latch INPUTS** that occur
within that window; future inputs are not injected early. It uses the
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
