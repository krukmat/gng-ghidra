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
