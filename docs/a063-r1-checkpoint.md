# A0.6.3-R1 — Contract + forensics checkpoint (branch-only)

Branch: feature/a063-r1-forensics-contract
Base: 9f8e9ad (main at branch creation)

## Why this block exists

The last native MAME run produced **17,135** same-line CPU prestate and
signature markers with zero reported PC/CPU/physical line mismatches; all
17,135 signature pairs had >=1 component above 0xFF. Strict provenance is
**BLOCKED** (`A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`). No ROM or trace is
available remotely; ROM-free unit tests cannot authenticate a bank.

## Implementation (R1)

- **T1 Capture action contract:** `scripts/a063_trace_contract.py emit`
  now supplies the signature trace action to `scripts/r2-mame-probe.sh`.
  It insists on exactly 9 CPU arguments followed by 2 distinct side-effect-free
  `b@` expressions inside the bank window `0x4000..0x5fff`. Format width
  is the original MAME `%02X` minimum width; no `& 0xff` truncation.
- **T2 Private preflight:** `scripts/r3-bank-provenance-capture.sh`
  fingerprints the selected MAME binary, its reported version, relevant source
  files and the exact action **before** starting the emulator. Manifest stays
  in ignored `out/r3/banked-provenance/private-a063-preflight.json`, mode
  `0600`. An unexpected existing manifest blocks reuse rather than
  laundering stale capture evidence. This is not post-capture attestation.
- **T3 Redacted triage:** `scripts/a063_trace_contract.py triage` consumes
  the aggregate `diagnose` JSON, checks counter consistency, classifies
  shape/alignment, overflow and readiness for the existing strict parser.
  Triage *never* certifies a bank, even with 0 overflow.
- **T4 ROM-free negatives:** `tests/test_a063_trace_contract.py` covers
  offsets, arity, template tampering, changed source/MAME manifest, private
  location and invalid/inconsistent diagnostics. All tests are part of
  `scripts/r3-local-regression.sh`.
- **T5 Checkpoint:** `A063_R1_READY` is only contract/integrity readiness.
  An isolated native mini-probe driver (`scripts/a063-native-miniprobe.sh`)
  is prepared but **not run**. It uses `out/r3/a063-smoke/`, two frames/two
  seconds and refuses to overwrite existing evidence. It returns a redacted
  byte-shape result, not a bank identity certificate.

## Evidence and current gates

- Isolated, ROM-free Python test run: **8/8 PASS** before first branch commit;
  a ninth structural test for mini-probe isolation has been added but not yet
  executed in the full repository checkout.
- Main's earlier native data: **17,135/17,135** signatures still *invalid*.
- Full repository regression not claimed here unless executed independently.
- **R1 code prepared; MAME behaviour on native hardware not tested.**

## Operator-only step once private native data are available

```bash
git checkout feature/a063-r1-forensics-contract
bash scripts/r3-local-regression.sh
python3 scripts/r3_bank_provenance.py diagnose > out/r3/banked-provenance/private-a063-diagnostic.json
python3 scripts/a063_trace_contract.py triage --input out/r3/banked-provenance/private-a063-diagnostic.json
```

The first phase does not execute MAME and does not overwrite old evidence.
The isolated native mini-probe is **prepared, not run**. Its byte-shape gate
will not prove bank identity. R2 must independently compare the two valid
byte readings to authenticated bank entries before any full recapture.
Never publish ROMs, CPU trace, private offsets or witnesses; no GitHub Actions.

## Exit criteria

1. Shell-generated action matches the contract; negative cases fail closed.
2. Private preflight records emulator identity and action/source hashes.
3. Redacted triage reports *cause-isolation-required* for the historic 17,135.
4. Neither manifest nor triage can emit native-provenance PASS.
5. External R2 requirement explicitly marked BLOCKED until authenticated ROM,
   stock MAME and preserved native trace are available in a private environment.

Then R2: isolated minimal native run comparing byte-read signatures to MAME
bank-entry observation at instruction boundaries. Do not perform a full recapture
until that independent smoke proves the signature source behaves correctly.
