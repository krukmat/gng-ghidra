# R4.2 — T1/T2/T3 ROM-free validation closure

## Purpose

Close the R3/R4.2.A–H ROM-free implementation by **actually executing local Node
and Python tests** and checking their outputs, without MAME, ROMs or GitHub Actions.
Implementation in `main` must never be described as passing the complete regression
until these commands run on a full checkout.

### Implemented runner

`scripts/r42_validation_closure.py` executes, in order:

| Task | Actual subprocess | Required evidence |
| --- | --- | --- |
| T1.1 | `node --test tests/test_r42h_romfree_gate.mjs` | Node TAP exactly 9 tests, 9 PASS, 0 fail/cancel/skip |
| T1.2–T1.4 | `node scripts/r42h_romfree_gate.mjs --scale` | Manifest of 5,000 / 40,001 / 100,000 events; windows 1/2/3; hashes; baseline repeat; event/byte/pixel divergences; post-DMA freeze |
| T2.1–T2.3 | `bash scripts/r3-local-regression.sh` | Zero exit and `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H` (Node + Python tests) |
| T2.4 / T3 | Aggregate all outcomes | `PASS_ROM_FREE_ONLY` only if every command and contract succeeds; otherwise failure or environmental block |

No arbitrary user-supplied command execution, no MAME invocation, no CI, and no upload
of private artifacts. The subprocesses run locally inside the current checkout.
The runner writes `out/r3/r42-validation-closure.json` containing stage names,
exit codes, elapsed milliseconds, stdout/stderr SHA-256 and character counts,
**not stdout/stderr bodies** or ROM bytes. The scale report remains inside ignored
`out/r3/r42h-romfree-checkpoint.json`.

### Invocation

```bash
git pull --ff-only
python3 scripts/r42_validation_closure.py
```

One command performs T1, T2 and the T3 checkpoint checks. To run individual
suites use:

```bash
node --test tests/test_r42h_romfree_gate.mjs
node scripts/r42h_romfree_gate.mjs --scale
bash scripts/r3-local-regression.sh
```

Do not publish complete `out/`, native traces, screenshots, ROM images or full CPU
state. If defects are detected, fix only the relevant code, rerun the affected
suite and then rerun the closure command. T3 remains `REQUIRES_REPAIR_OR_LOCAL_RERUN`
until **all three stages** have passed.

### Evidence in this session — 24 October 2026

- **Real Python 3.13:** `python3 -m unittest discover -s tests -p
  test_r42_validation_closure.py -v` reproduced using the locally
  constructed copies of the published validator and test fixtures: **8/8 PASS**.
  Scenarios: complete synthetic pass, failure despite success-looking TAP,
  wrong scale, missing binary, missing output manifest, timeout,
  absent checkout, and log confidentiality.
- **Real Node 22:** independent nine-test TAP probe passed and the Python
  parser accepted its `tests=9 / pass=9 / fail=0 / skipped=0 / cancelled=0`.
  **This probe was not the project's H suite.**
- **Checkout availability:** Node and Python are installed in the available
  sandbox, but the runtime cannot resolve or connect to `github.com`.
  Consequently the GitHub repository cannot be cloned into that sandbox.
  Running the closure against this incomplete local workspace correctly
  returned `BLOCKED_MISSING_CHECKOUT`. This is an **environment restriction**,
  not evidence that H failed.
- **Not executed here:** real 9-test Node H suite, 5k/40k/100k Node scale
  run, and the complete R3/R4.2 Node/Python regression. Do not mark these PASS.

### External gates unchanged

The eventual R4/V2 first autonomous frame still requires a real MAME write-tap
run, independently verified pre-tap state and timeline, bank-by-instruction
A0.6.3/A0.6.4, IRQ/SYNC/VBlank and an independent native framebuffer comparison.
Neither an H synthetic PASS nor this ROM-free closure proves native timing,
MAME pixel parity or the game being playable.

**Decision:** No R4.2.I. Do not reopen synthetic laboratory expansion. Focus
exclusively on executable real regression once a checkout is available and
the independent native gates thereafter.
