# G5-FAST — B0+B1: regression + multi-frontier static Z80 scanner

**Date:** 2026-10-27 · **Repo:** krukmat/gng-ghidra · **Branch:** main  
**Scope:** only Z80 audio tooling and documentation. Original MC6809 engine, gameplay bot, and YM2203 synth source remain unchanged.  
**Checkpoint:** IMPLEMENTED / awaiting full operator-Mac acceptance. The initial code and 30 pure JS synthetic cases were evaluated in an isolated JS harness, **not** in the actual full Node/Python checkout. No ROM-native scan output has been seen for this revision; no audio or MAME parity is certified.

## Six tasks and dependency chain

| Task | Dependence | Deliverable | Implementation state |
| --- | --- | --- | --- |
| B0.T1 | none | Seven LD r,n destinations + LD (HL),n validated for flags, register isolation, immediate 00/FF, PC, RAM bus write and 7T/10T | Implemented in tests/test_gngb_z80_static_codegen.mjs |
| B0.T2 | B0.T1 | Unified Node+Python regressions, ROM SHA1, Git ignored/untracked out/ and private output gate | Implemented in scripts/audio_fast_checkpoint.mjs; pending run on Mac |
| B1.T1 | B0 | Multi-root CFG exploration; deduplicated static frontiers; operator-supplied PC seeds; never continue over unknown-length instructions | Implemented in src/gngb_z80_static_codegen.mjs and scripts/audio_z80_scan.mjs |
| B1.T2 | B1.T1 | Priority from count of blocked static PCs by family (not presumed dynamic frequency), deterministic tie breaks | Implemented in src/gngb_audio_frontier_report.mjs |
| B1.T3 | B1.T1/T2 | Private bounded JSON summary; no ROM bytes, immediate values, generated JS, absolute paths or PCM | Implemented, output out/audio/z80-frontier-report.json |
| B1.T4 | B0+B1 | One local checkpoint command, explicit stop/partial statuses and safety CLI tests | Implemented in scripts/audio_fast_checkpoint.mjs and tests/test_gngb_audio_fast_cli.mjs |

## Single operator command

From repo root on the Mac, after the personal verified sound ROM has already been extracted to out/audio/gg2.bin:

    git checkout main && git pull --ff-only
    node scripts/audio_fast_checkpoint.mjs

This runs, in one command:
1. Node audio regressions for Z80 AOT, safe frontend scanner, CLI safety, original sound events, sound bus, and PCM queue.
2. Python audio regressions.
3. Verifies .gitignore includes out/ and git has no files tracked in out/.
4. SHA1-checks the local gg2.bin (32768 bytes) inside the scanner, using the known original ROM identity.
5. Explores static CFG and writes private diagnostic JSON under out/audio/.
6. Builds the private, ROM-derived static prefix under out/audio/ only, and prints one **sanitized** GNG_AUDIO_G5_FAST_CHECKPOINT_V1 JSON result.

If gg2.bin is not present, use the prior documented extractor first:

    python3 scripts/audio_extract_sound_rom.py --rom roms/gngb.zip --shared roms/gng.zip

**Interpretation:**
- PASS_REGRESSION_STATIC_SCAN_Z80_NOT_CERTIFIED = regressions passed and static discovery ran; a remaining Z80 instruction blocker is expected. Does **not** mean full Z80 or playable music.
- PASS_REGRESSION_SCAN_TRUNCATED = regressions passed but the configured scan budget ended before exhausting reachable static paths; repeat only with a larger safe --limit using the standalone scanner after investigation.
- STOP_REGRESSION / STOP_PRIVATE_ARTIFACT_GUARD / STOP_ROM_OR_SCAN / STOP_AOT_BUILD = gate failure. Do not bypass.
- The legacy build can still say PARTIAL_UNCERTIFIED and exit 2 without turning a green **discovery** checkpoint into a Z80 GO.

The scanner can also be run independently, without involving any other game subsystem:

    node scripts/audio_z80_scan.mjs --limit 4096 --max-frontiers 128

Private report: out/audio/z80-frontier-report.json. Share only the sanitized console JSON, NOT gg2.bin, z80-prefix.mjs, the ROM archive, generated code, native dumps, raw event tapes or private report files.

## Optional native PC roots — NOT an automatic ROM disassembler

By default, the scanner starts only at RESET vector PC=0 and explores the subset of control-flow **statically justified** by supported instructions. It does not assume unsupported bytes have known instruction length or scan arbitrary ROM bytes looking for opcodes.

If you later collect **independently sourced** native Z80 executed PC addresses in MAME, store a manual local descriptor inside ignored out/audio/native-z80-pcs.json with this schema:

    {
      "kind": "GNG_AUDIO_Z80_OPERATOR_PCS_V1",
      "rom_sha1": "7ef9ec5c2072e21c787a6bbf700033f50c759c1d",
      "pcs": [256, 512]
    }

The addresses shown above are syntactic examples, **not** observed native PCs. Run:

    node scripts/audio_fast_checkpoint.mjs --roots out/audio/native-z80-pcs.json

This adds PC=0 and those operator-supplied roots (maximum 64), classifying their downstream static frontiers. The software validates PC ranges and ROM identity but **cannot authenticate** that operator-supplied roots truly came from MAME. Report labels them OPERATOR_SUPPLIED_PCS, never native verified.

## Report contract / measurement

GNG_AUDIO_Z80_FRONTIER_SCAN_V1 exposes:
- status, rom_identity=SHA1_MATCH, seed_source, operator_seed_count
- static_decoded_pcs; static_frontiers_total; static_frontiers_reported/omitted; pending_static_edges; truncated; scan_limit
- families: family, blocked_static_pcs, first_pc, priority=P0, sorted primarily by blocked_static_pcs descending
- frontiers: bounded PCs, family/reason, optional ED mnemonic category
- explicit false flags: executed_pc_coverage_verified, native_trace_parity_verified, z80_timing_parity_verified, ym_pcm_verified and gameplay_audio_verified.

**No percent complete** is inferred from static_decoded_pcs or scanned ROM bytes. One static frontier can conceal a very large dependency; a successful static exit can still omit interrupt vectors, indirect returns, dynamic data or paths outside the analyzed static CFG. Native evidence and YM writes/PCM are separate G5 acceptance gates.

## Validation evidence / outstanding gates

- Existing Mac evidence before B0+B1: 18/18 Node tests PASS; previous private-ROM AOT: 12 static decoded PCs, one unsupported LD_R_IMMEDIATE at PC 248 (0x00F8).
- Baseline implementation as of this block also includes AOT LD r,n (B,C,D,E,H,L,A and (HL)) with 7/10 T-state timing, but **that code was not yet run against the operator's ROM**.
- New B0+B1 module tests: 30/30 synthetic tests PASS via an isolated JS harness across compiler and safe report, including 24 Z80 tests and 6 summary tests.
- Four additional CLI tests (private paths, CLI flags, Git ignored/untracked out/) are authored but require the actual Node process spawn runner for verification.
- Full command's Node/Python/ROM/CFG/build gates: **NOT YET EXECUTED ON MAC IN THIS BLOCK**.

**Next checkpoint:** run the single command once, return GNG_AUDIO_G5_FAST_CHECKPOINT_V1 only. Use the grouped static blocker counts to implement batches of actually observed families, not sequential speculative opcode guessing. Parallel B3 YM2203 first WAV path remains an independent priority.

No GitHub Actions, no cloud/local-network dependencies, no third-party ROM, no changes to engine or bot.
