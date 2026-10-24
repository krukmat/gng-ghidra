# R4.2.H — ROM-free E2E consolidation checkpoint

## Goal and allowed evidence

Consolidate the R4.2.F **event format** → R4.2.G incremental board → shared pixel renderer. All H inputs are deliberately synthetic. H **does not execute** the MAME Lua recorder or the Python F validator, cannot certify G's native-source claim and cannot claim an autonomous MC6809-generated game frame. Real native data and scripts stay in ignored `out/`; no GitHub Actions.

### Delivered tasks

- **H1 — End-to-end:** `src/r42h_romfree_gate.mjs` synthesizes F-shaped UTF-8 JSONL with frame, elapsed emulator time, declared absent raster values, write, DMA, final checkpoint and a matching SHA256. The source is explicitly `SYNTHETIC_F_FORMAT_TEST_NOT_MAME` despite following the F envelope. `replayR42gTimeline` consumes the stream and applies it to the G board + shared R4.2.B renderer with **no 6809 opcode interpreter**. An independent laboratory board reconstructs the same final frame; all component hashes and the RGBA hash must match or the harness rejects.
- **H2 — Integrity:** fail closed if bootstrap bytes or origin change without a digest change, if the stream changes without updating its SHA256, or if state is incomplete. Previous G/F tests also cover missing DMA, address, mask, order and truncation. **Not** an independent native capture attestation.
- **H3 — Scale:** proportional cases **5,000**, **40,001** (window boundary), and **100,000** events (three windows). The one-million-event cap remains optional, **not** a mandatory endurance test. The CLI records processing milliseconds and heap **change** (not peak) for each case, with no device-independent performance threshold.
- **H4 — Diagnosis:** compare baseline vs a single changed sprite-RAM write **before DMA** and a write **after DMA**. Find the first changed event by comparing event contents, the first different DMA byte offset/address and first differing RGBA pixel (x/y/channel); assert the second write remains visually invisible until a new DMA. The report never prints proprietary memory bytes or a framebuffer.
- **H5 — Gate:** `scripts/r42h_romfree_gate.mjs` emits an aggregate JSON checkpoint under ignored `out/r3/`; ROM-free tests belong to `scripts/r3-local-regression.sh`. Native F taps, reset coverage, raster/IRQ/SYNC, A0.6.3 bank attribution, and real PNG pixel equivalence **remain separate gates**.

## Reproduce on any cloned repository (no ROM required)

```bash
git pull --ff-only
node --test tests/test_r42h_romfree_gate.mjs
node scripts/r42h_romfree_gate.mjs --events 5000
node scripts/r42h_romfree_gate.mjs --scale
bash scripts/r3-local-regression.sh
```

`--scale` runs a baseline diagnostic at 5,000 and one E2E pass at each of 5,000/40,001/100,000 events. The report is `out/r3/r42h-romfree-checkpoint.json`. Only `--events 5000|40001|100000` is supported; this is intentional. This is still a synthetic laboratory report. The `--out` option is confined to private `out/`.

## Evidence and limitations (2026-10-24)

The new H tests were run with **exact current GitHub JS sources in isolated V8** and dependency injection, including a **deterministic noncryptographic test hash instead of Node's SHA256**. **9/9 tests passed**, including the 100k-event 3-window case. A separate synthetic 5k diagnostic produced first event `seq=0`, first changed DMA byte offset `3` (CPU sprite address `0x1E03`), and first different RGBA pixel `(34, 66, R)`. A post-DMA sprite-RAM write changed input without changing buffered sprites or pixel output.

**Pending / noncertified:** test execution in native Node with real SHA256 and filesystem, complete Node/Python regression, actual MAME Lua tap execution, ROM/bank origin and raster/IRQ alignment, first authentic game frame. V8 evidence does not imply the entire repo's local regression passed.

## STOP conditions for native certification

- H's source is synthetic, so no H report can be relabeled native.
- F logs only post-autoboot callback order; pre-tap byte coverage must be supplied with independently verified initialization, not a final R0 snapshot reused as an initial seed.
- G may report state equality without proving temporal equivalence.
- First real frame requires separate native MAME capture, exact pixel comparison, bank-by-instruction A0.6.3, IRQ/SYNC and continuous original MC6809 logic compiled into JS.
