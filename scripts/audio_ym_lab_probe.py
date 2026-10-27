#!/usr/bin/env python3
"""ROM-free B3 hardware-independent PSG probe for the pinned native YM2203 renderer.

All emitted files stay under ignored out/audio; stdout is sanitized metrics only.
A successful probe verifies basic YM2203 -> PCM plumbing, not native ROM fidelity.
"""
import json
import sys
from pathlib import Path

import audio_b3_checkpoint as b3

PROBE_TSV = b3.PRIVATE / "b3-probe-psg.tsv"
PROBE_WAV = b3.PRIVATE / "b3-probe-psg.wav"

# YM2203 PSG, channel A, 1.5MHz chip input, test tone.
# Select tone-A period, mute noise-A and both other channels, set A volume=15.
# Native GNG game writes are NOT used, and no private ROM is needed.
PSG_TONE_REGISTERS = [
    (0x00, 0x20), (0x01, 0x00),
    (0x07, 0x3e), (0x08, 0x0f),
]


def make_psg_tsv():
    if PROBE_TSV.exists():
        raise b3.B3Stop("PROBE_ARTIFACT_ALREADY_EXISTS")
    if PROBE_WAV.exists():
        raise b3.B3Stop("PROBE_ARTIFACT_ALREADY_EXISTS")
    lines = []
    # Register address port 0xe000; data port 0xe001 (chip 0).
    for reg, value in PSG_TONE_REGISTERS:
        lines.append(f"0 57344 {reg}")
        lines.append(f"0 57345 {value}")
    b3.ensure_private(PROBE_TSV).write_text("\n".join(lines) + "\n", encoding="ascii")


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print(json.dumps({"kind": "GNG_AUDIO_B3_YMFM_PROBE_V1",
                          "status": "STOP", "reason": "YMFM_SOURCE_ARG_REQUIRED"}))
        return 2
    try:
        b3.PRIVATE.mkdir(parents=True, exist_ok=True)
        b3.verify_repository_privacy()
        source = Path(args[0]).expanduser().resolve()
        if not source.is_dir():
            raise b3.B3Stop("YMFM_SOURCE_MISSING")
        make_psg_tsv()
        b3.call(["bash", "scripts/audio_ym_native_build.sh", str(source)])
        b3.call([str(b3.ensure_private(b3.PRIVATE / "ym2203_lab", must_exist=True)),
                 str(b3.ensure_private(PROBE_TSV, must_exist=True)),
                 str(b3.ensure_private(PROBE_WAV)), "1000"])
        measures = b3.wav_metrics(PROBE_WAV, expected_rate=b3.EXPECTED_RATE)
        if measures["peak"] == 0:
            raise b3.B3Stop("SYNTHETIC_PSG_SILENT")
        print(json.dumps({
            "kind": "GNG_AUDIO_B3_YMFM_PROBE_V1",
            "status": "NON_SILENT_PSG_SYNTHETIC_ONLY",
            "sample_rate_hz": measures["rate_hz"],
            "duration_ms": measures["duration_ms"],
            "peak": measures["peak"],
            "rms": measures["rms"],
            "nonzero_samples": measures["nonzero_samples"],
            "native_parity_verified": False,
            "game_audio_verified": False,
            "private_outputs_only": True,
        }, separators=(",", ":")))
        return 0
    except (b3.B3Stop, OSError, ValueError) as error:
        reason = str(error) if isinstance(error, b3.B3Stop) else "PROBE_IO_STOP"
        print(json.dumps({"kind": "GNG_AUDIO_B3_YMFM_PROBE_V1",
                          "status": "STOP", "reason": reason,
                          "game_audio_verified": False}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
