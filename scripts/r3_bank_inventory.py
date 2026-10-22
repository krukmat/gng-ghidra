#!/usr/bin/env python3
"""A0.6: locally materialize the 5 CRC-validated gngb bank images and
profile existing MAME bank *samples* without claiming instruction provenance.

No MAME run, no ROM bytes/opcodes/register values exposed in report.
Requires the operator's private roms/gng.zip and unchanged out/gngb-flat.bin.
Private binary material stays in ignored out/r3/banked-rom/.
"""
from __future__ import annotations
import argparse
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from poc import read_rom  # CRC, exact files/length and reset vector

SCHEMA = "gng.a06.native-bank-inventory.v1"
BANK_SIZE = 0x2000
BANK_COUNT = 5
PACKED_SIZE = BANK_SIZE * BANK_COUNT


def assemble_banks(zip_path: Path) -> tuple[bytes, bytes]:
    """Only verified gngb original ZIP can supply real bank bytes."""
    flat, _ = read_rom(zip_path)
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        def member(name: str) -> bytes:
            found = [path for path in names
                     if path.rsplit("/", 1)[-1].lower() == name]
            if len(found) != 1:
                raise ValueError("A06_UNIQUE_AUTHENTIC_ROM_MEMBER_REQUIRED")
            return archive.read(found[0])
        gg5, gg4 = member("gg5.bin"), member("gg4.bin")
    if len(gg5) != 0x8000 or len(gg4) != 0x4000 or len(flat) != 65536:
        raise ValueError("A06_GNGB_BANK_IMAGE_SIZE_INVALID")
    if flat[0x4000:0x6000] != gg4[:BANK_SIZE] or (
            flat[0x6000:0x8000] != gg4[BANK_SIZE:]):
        raise ValueError("A06_FLAT_ROM_BANK4_MAPPING_MISMATCH")
    image = gg5 + gg4[:BANK_SIZE]
    if len(image) != PACKED_SIZE:
        raise ValueError("A06_PACKED_BANK_IMAGE_SIZE_INVALID")
    return image, flat


def bank_entry_from_control(data: int) -> int:
    """Exact gng_state::bankswitch_w selection logic."""
    if not isinstance(data, int) or isinstance(data, bool) or not 0 <= data <= 255:
        raise ValueError("A06_INVALID_BANK_CONTROL_BYTE")
    return 4 if data == 4 else data & 3


def analyze_native_bank_samples(observations: str) -> dict:
    """Summarize frame samples and write taps; no PC-to-bank attribution."""
    if not isinstance(observations, str):
        raise ValueError("A06_NATIVE_TSV_REQUIRED")
    seen_initial = 0
    initial = None
    frame = Counter()
    at_write = Counter()
    expected_selected = Counter()
    write_count = None
    write_samples = 0
    invalid_samples = 0
    reset_notifications = 0
    seen_end = 0
    for line in observations.splitlines():
        if not line:
            continue
        fields = line.split("\t")
        tag, args = fields[0], fields[1:]
        if tag == "BANK_INITIAL_OBSERVED":
            seen_initial += 1
            if len(args) != 1:
                raise ValueError("A06_INITIAL_BANK_SAMPLE_INVALID")
            initial = args[0]
        elif tag == "FRAME_SAMPLE":
            if len(args) != 3:
                raise ValueError("A06_FRAME_BANK_SAMPLE_INVALID")
            try:
                entry = int(args[2])
                if 0 <= entry < BANK_COUNT and str(entry) == args[2]:
                    frame[entry] += 1
                else:
                    invalid_samples += 1
            except ValueError:
                invalid_samples += 1
        elif tag == "BANK_CONTROL_WRITE_SAMPLE":
            if len(args) != 5 or args[2] != "15872":  # 0x3e00
                raise ValueError("A06_BANK_WRITE_SAMPLE_SHAPE_INVALID")
            write_samples += 1
            try:
                data = int(args[3])
                if not 0 <= data <= 255 or str(data) != args[3]:
                    raise ValueError()
                expected_selected[bank_entry_from_control(data)] += 1
                old = int(args[4])
                if not 0 <= old < BANK_COUNT or str(old) != args[4]:
                    raise ValueError()
                at_write[old] += 1
            except ValueError:
                invalid_samples += 1
        elif tag == "OBSERVED_BANK_CONTROL_WRITE_COUNT":
            if write_count is not None or len(args) != 1 or not args[0].isdigit():
                raise ValueError("A06_BANK_WRITE_COUNT_INVALID")
            write_count = int(args[0])
        elif tag == "RESET_NOTIFICATION":
            reset_notifications += 1
        elif tag == "PROBE_END":
            seen_end += 1
    if seen_initial != 1 or seen_end != 1 or write_count is None or (
            write_samples > write_count or write_samples > 64):
        raise ValueError("A06_NATIVE_BANK_PROBE_INCOMPLETE")
    initial_entry = None
    if initial is not None and initial.isdecimal() and (
            initial in ("0", "1", "2", "3", "4")):
        initial_entry = int(initial)
    return {
        "bank_initial_observed_entry": initial_entry,
        "sampled_frame_bank_entries": {str(k): frame[k] for k in range(BANK_COUNT)},
        "sampled_control_writes_before_handler": write_samples,
        "total_bank_control_writes": write_count,
        "expected_selected_bank_entries_from_control_data": {
            str(k): expected_selected[k] for k in range(BANK_COUNT)
        },
        "bank_entries_sampled_inside_write_tap": {
            str(k): at_write[k] for k in range(BANK_COUNT)
        },
        "unparseable_native_bank_samples": invalid_samples,
        "native_soft_reset_notifications": reset_notifications,
        "complete_bank_switch_edges_proven": False,
        "bank_entry_for_each_instruction_proven": False,
        "native_instruction_to_bank_mapping_proven": False,
    }


def count_trace_banked_pcs(pretrace: str) -> dict:
    if not isinstance(pretrace, str):
        raise ValueError("A06_NATIVE_PRETRACE_REQUIRED")
    count = 0
    pcs: set[int] = set()
    lines = 0
    for line in pretrace.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if (not isinstance(event, dict)
            or event.get("schema") != "gng.r2.pre-instruction.v1"
            or event.get("kind") != "pre_instruction"
            or event.get("origin") != "mame-native-tracelog"
            or type(event.get("seq")) is not int or event["seq"] != lines
            or type(event.get("pc")) is not int
            or not 0 <= event["pc"] <= 65535
            or not isinstance(event.get("before"), dict)
            or event["before"].get("PC") != event["pc"]):
            raise ValueError("A06_NATIVE_PRETRACE_INVALID")
        pc = event["pc"]
        if 0x4000 <= pc <= 0x5fff:
            pcs.add(pc)
            count += 1
        lines += 1
    if lines < 3:
        raise ValueError("A06_NATIVE_PRETRACE_EMPTY")
    return {
        "native_preinstruction_samples": lines,
        "bank_window_pc_samples": count,
        "distinct_bank_window_pcs": len(pcs)
    }


def private_destination(path: Path) -> bool:
    root = (ROOT / "out" / "r3").resolve()
    candidate = path.resolve()
    return candidate != root and candidate.is_relative_to(root)


def inventory(zip_path: Path, flat_path: Path, observations_path: Path,
              trace_path: Path, output_dir: Path) -> dict:
    if not private_destination(output_dir):
        raise ValueError("A06_PRIVATE_OUTPUT_REQUIRED")
    packed, flat = assemble_banks(zip_path)
    if flat_path.read_bytes() != flat:
        raise ValueError("A06_EXISTING_PRIVATE_FIXED_ROM_MISMATCH")
    samples = analyze_native_bank_samples(observations_path.read_text())
    coverage = count_trace_banked_pcs(trace_path.read_text())
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / "private-banked-rom.bin"
    if image_path.exists():
        if image_path.read_bytes() != packed:
            raise ValueError("A06_EXISTING_PRIVATE_BANK_IMAGE_MISMATCH")
    else:
        with image_path.open("xb") as stream:
            stream.write(packed)
    report = {
        "schema": SCHEMA,
        "status": "AUTHENTIC_FIVE_BANK_IMAGES_READY_NATIVE_PC_BINDING_UNKNOWN",
        "maincpu_bank_window": "0x4000-0x5fff",
        "selection_register": "0x3e00",
        "authentic_rom_files_crc_validated": True,
        "packed_bank_image_size": PACKED_SIZE,
        "available_bank_entries": [0, 1, 2, 3, 4],
        "bank_entry_4_maps_to_gg4_first_half": True,
        "bank_entries_0_to_3_map_to_gg5_chunks": True,
        "fixed_rom_private_image_matches_source_zip": True,
        **coverage, **samples,
        "power_on_selected_bank_proven": False,
        "banked_cpu_execution_equivalent": False,
        "full_bus_irq_or_game_verified": False,
        "game_playable": False,
        "raw_rom_bytes_opcodes_or_registers_exported": False,
        "next_task": (
            "Obtain instruction-correlated native bank entry at each "
            "0x4000-0x5fff CPU PC and post-handler 0x3e00 switch boundary; "
            "only then compile the observed bank/PC pairs.")
    }
    (output_dir / "report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, default=ROOT / "roms/gng.zip")
    parser.add_argument("--flat", type=Path, default=ROOT / "out/gngb-flat.bin")
    parser.add_argument("--trace", type=Path,
                        default=ROOT / "out/r2/mame-probe/pre-instruction.jsonl")
    parser.add_argument("--observations", type=Path,
                        default=ROOT / "out/r2/mame-probe/observations.tsv")
    parser.add_argument("--out", type=Path,
                        default=ROOT / "out/r3/banked-rom")
    args = parser.parse_args()
    try:
        report = inventory(args.zip, args.flat, args.observations,
                           args.trace, args.out)
    except (ValueError, OSError, KeyError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
