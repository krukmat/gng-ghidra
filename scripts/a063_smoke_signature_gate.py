#!/usr/bin/env python3
"""Private A063 smoke: validate each native byte pair against authentic ROM.

This gate DOES NOT independently observe MAME bank.entry at every instruction.
No bank sequence, signature, addresses, ROM contents or CPU state are exported.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from r3_bank_provenance import (load_authenticated_images,
                                choose_signature_offsets,
                                parse_debugger_bank_signatures)
from r3_bank_inventory import analyze_native_bank_samples

SCHEMA = "gng.a063.private-smoke-rom-signature-gate.v1"


def summarize(entries: list[int], samples: dict) -> dict:
    if not entries or any(type(v) is not int or not 0 <= v <= 4 for v in entries):
        raise ValueError("A063_SMOKE_NATIVE_BANK_ENTRIES_INVALID")
    frames = samples.get("sampled_frame_bank_entries")
    writes = samples.get("sampled_control_writes_before_handler")
    if not isinstance(frames, dict) or type(writes) is not int or writes < 0:
        raise ValueError("A063_SMOKE_NATIVE_FRAME_SAMPLES_INVALID")
    observed = set(entries)
    frame_entries = {int(k) for k, count in frames.items() if type(count) is int and count > 0}
    if any(not 0 <= bank <= 4 for bank in frame_entries):
        raise ValueError("A063_SMOKE_FRAME_BANK_OUT_OF_RANGE")
    checkpoint_consistent = bool(frame_entries) and frame_entries.issubset(observed)
    if len(entries) < 256:
        status = "INCONCLUSIVE_FEWER_THAN_256_PRESTATES"
    elif len(observed) < 2 or writes == 0:
        status = "INCONCLUSIVE_NO_AUTHENTICATED_TRANSITION"
    elif not checkpoint_consistent:
        status = "INCONCLUSIVE_FRAME_BANK_NOT_OBSERVED_IN_TRACE"
    else:
        status = "AUTHENTIC_ROM_PAIR_MATCHES_NEEDS_INSTRUCTION_BOUNDARY_ORACLE"
    return {
        "schema": SCHEMA,
        "status": status,
        "native_prestate_count": len(entries),
        "per_instruction_authentic_byte_pair_match_count": len(entries),
        "distinct_authentic_rom_banks_seen": len(observed),
        "native_bank_control_write_samples": writes,
        "frame_sample_bank_set_subset_of_trace_bank_set": checkpoint_consistent,
        "frame_samples_independently_instruction_correlated": False,
        "bank_identity_per_instruction_independently_verified": False,
        "native_bank_provenance_certified": False,
        "lowbyte_mask_used": False,
        "exported_raw_rom_cpu_trace_or_bank_sequence": False,
    }


def evaluate(root: Path) -> dict:
    root = root.resolve()
    smoke = root / "out" / "r3" / "a063-smoke"
    roms = root / "out" / "r3" / "banked-rom" / "private-banked-rom.bin"
    config = root / "out" / "r3" / "banked-provenance" / "private-signature-offsets.json"
    packed, _ = load_authenticated_images(root / "roms" / "gng.zip",
                                          root / "out" / "gngb-flat.bin", roms)
    offsets = tuple(json.loads(config.read_text(encoding="utf-8"))["offsets"])
    if offsets != choose_signature_offsets(packed):
        raise ValueError("A063_SMOKE_SIGNATURE_OFFSETS_NOT_AUTHENTIC")
    rows = [json.loads(line) for line in
            (smoke / "pre-instruction.jsonl").read_text(encoding="utf-8").splitlines()
            if line]
    entries = parse_debugger_bank_signatures(
        (smoke / "cpu.trace").read_text(encoding="utf-8"), rows, packed, offsets)
    samples = analyze_native_bank_samples(
        (smoke / "observations.tsv").read_text(encoding="utf-8"))
    result = summarize(entries, samples)
    artifact = smoke / "private-a063-smoke-rom-check.json"
    with artifact.open("x", encoding="utf-8") as out:
        json.dump(result, out, sort_keys=True, indent=2)
        out.write("\n")
    os.chmod(artifact, 0o600)
    return result


def main():
    try:
        result = evaluate(ROOT)
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit("A063_SMOKE=BLOCKED invalid_authentic_rom_pairs_or_evidence") from exc
    print("A063_SMOKE=" + result["status"])


if __name__ == "__main__":
    main()
