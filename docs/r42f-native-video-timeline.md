# R4.2.F — MAME video write timeline (test oracle only)

## Scope and supported facts

The R0 reference capture already records a MAME frame, FG/BG RAM,
buffered sprites, RGBA palette, scroll and their manifest. R4.2.F adds
an **optional** private write-tap event timeline to the **same MAME run**.
Neither MAME nor its ROMs become part of the JavaScript product.

Source contracts:
- MAME Lua `address_space:install_write_tap(start,end,name,callback)`
  receives (address, data, mask) and a pass-through callback returns data.
  https://docs.mamedev.org/luascript/ref-mem.html
- MAME Lua `screen.frame_number` is documented as a property.
  https://docs.mamedev.org/luascript/ref-devices.html
- `machine.time` is elapsed emulation time.
  https://docs.mamedev.org/luascript/ref-core.html

**The Lua screen API does not document a direct raster vpos/hpos getter.**
The timeline therefore records the frame number and emulated seconds, but
requires `raster_vpos=null`, `raster_hpos=null` and
`raster_unobserved=true`. An inferred scanline or a frame notifier is
NOT proof of an exact raster/VBlank boundary.

## Tasks

- **F1 — Contract:** each JSONL line contains sequential `seq`,
  `kind` (`WRITE8`, `DMA` or final `CHECKPOINT`), `address`,
  `data`, `mask`, `frame`, `emu_seconds` and explicit unavailable
  raster metadata. The optional metadata file binds driver/target frame
  and a 128-bit randomly generated run identifier. Only post-autoboot
  tap installation is covered; reset/boot events that predate installation
  are **not** declared observed.
- **F2 — Native instrumentation:** `scripts/r42f_native_video_taps.lua`
  installs non-overlapping taps for `0x1E00–0x2FFF` (sprite RAM and
  FG/BG) and `0x3800–0x39FF` (palette). Existing R0 taps for
  `0x3B08–0x3B0B` (scroll) and `0x3C00` (sprite DMA) also emit
  events, avoiding a second tap on those addresses. All original data
  values pass through unchanged. Unsupported data/mask width, nonmonotone
  frame/time, exceeded limit, failed write, missing DMA or incomplete
  checkpoint ABORT the capture without a complete metadata file.
  Recording is opt-in and disabled by default.
- **F3 — Validation:** `scripts/r42f_validate_timeline.py` verifies
  exact JSON keys, no duplicates, consecutive sequence, allowed address,
  8-bit data/mask, monotone time and frame, final single checkpoint,
  declared counts, frame and DMA agreement with R0, run ID, and SHA-256
  of the private JSONL and metadata files. `capture_real_frame.py`
  embeds the aggregate validation in `manifest.json` only if the
  optional capture succeeds. The result remains
  `STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED`.
- **F4 — ROM-free adversarial checks:** fixture-only tests reject dropped
  events, reordered lines, forged masks, out-of-map writes, corrupt run
  IDs/counts/frame, fake raster/IRQ claims, duplicate JSON fields and
  incomplete termination. No ROM or MAME required for these tests.
- **F5 — Regression/documentation:** Python tests and syntax checks are
  in `scripts/r3-local-regression.sh`, **without GitHub Actions**.

## Private capture command

Run on a machine with a legitimately installed MAME and local GNG ROMs:

```bash
git pull --ff-only
python3 scripts/capture_real_frame.py --system gngb \
  --rompath roms --frame 600 --out out/reference/mame \
  --r42f-timeline
```

To check the command without MAME or a ROM:

```bash
python3 scripts/capture_real_frame.py --system gngb \
  --rompath roms --frame 600 --out out/reference/mame \
  --r42f-timeline --dry-run
```

The dry-run still requires an existing ROM **directory**, but does not
load any ROM or run MAME.

Files created only inside ignored `out/reference/mame`:
`r42f-native-events.jsonl`, `r42f-native-metadata.json`, existing
R0 artifacts, plus `manifest.json` with `r42f_native_timeline`.
Do not commit, upload, or paste private ROM, full trace, raw memory,
PNG or screenshots publicly.

## Gate: what is and is not established

The captured order is the **order of Lua tap callback invocations**,
not the independently proven retirement order of MC6809 instructions.
A monotonically increasing sequence and time do not prove exact
CPU/raster timing. Likewise, a randomly generated run ID and SHA-256
prove local self-consistency across these files, **not independent
cryptographic attestation of a MAME process**.

Native validation still requires an actual MAME run with those private
files. To certify R4/V2, additional work must verify exact per-instruction
bank identity (A0.6.3), IRQ/SYNC, reset coverage, DMA timing, scanline
and frame synchronization and independent reference pixels. No
synthetic fixture or successful ROM-free test can satisfy that gate.

**STOP** if the Lua API cannot install taps, if 8-bit masks are not
observed, if event count exceeds the cap, if frame/time ordering changes,
or if the final R0 DMA/frame and timeline checkpoint disagree. Resolve
the native instrumentation discrepancy before claiming equivalence.
