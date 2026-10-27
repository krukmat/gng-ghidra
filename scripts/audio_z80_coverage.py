#!/usr/bin/env python3
"""Compare saved native MAME Z80 executed PCs with PRIVATE static AOT census.

The trace is not a CPU parity oracle. All raw PCs, ROM, trace and reports stay
under ignored out/audio; stdout has counts only. No ROM-derived bytes exported.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import audio_b3_checkpoint as b3
import audio_z80_native_pc as pc

REPORT_NAME = re.compile(r"z80-frontier-[a-zA-Z0-9][a-zA-Z0-9_-]{0,75}\.json\Z")


class CoverageStop(Exception):
    pass


def validate_report(name):
    if not isinstance(name, str) or REPORT_NAME.fullmatch(name) is None:
        raise CoverageStop("STATIC_REPORT_NAME_INVALID")
    path = b3.ensure_private(b3.PRIVATE / name, must_exist=True)
    if path.stat().st_size > 2 * 1024 * 1024:
        raise CoverageStop("STATIC_REPORT_OVERSIZE")
    try:
        data = json.loads(path.read_text(encoding="utf8"))
    except (UnicodeError, ValueError, OSError):
        raise CoverageStop("STATIC_REPORT_INVALID_JSON") from None
    if (not isinstance(data, dict) or data.get("kind") != "GNG_AUDIO_Z80_FRONTIER_SCAN_V1" or
        data.get("rom_identity") != "SHA1_MATCH" or
        data.get("seed_source") != "OPERATOR_SUPPLIED_PCS" or
        data.get("status") not in ("PARTIAL_UNCERTIFIED", "TRUNCATED",
                                  "NO_STATIC_BLOCKER_NOT_CERTIFIED") or
        data.get("native_trace_parity_verified") is not False or
        data.get("static_generated_code_exported") is not False):
        raise CoverageStop("STATIC_REPORT_UNCERTIFIED_OR_INVALID")
    def pcs(key, maximum):
        values = data.get(key)
        if (not isinstance(values, list) or len(values) > maximum or
            any(type(value) is not int or value < 0 or value >= 0x8000 for value in values) or
            len(set(values)) != len(values)):
            raise CoverageStop("STATIC_REPORT_PCS_INVALID")
        return set(values)
    roots = pcs("operator_seed_pcs", 64)
    visited = pcs("static_visited_pcs", 16384)
    if (not roots or
        type(data.get("static_decoded_pcs")) is not int or
        len(visited) != data["static_decoded_pcs"]):
        raise CoverageStop("STATIC_REPORT_CENSUS_INVALID")
    return roots, visited


def coverage(capture_id, report_name):
    report_roots, compiled_pcs = validate_report(report_name)
    pc.verify_sound_rom()
    seen, markers, standard, heartbeat = pc.scan_native_trace(capture_id)
    observed = markers if markers else standard
    if not observed:
        raise CoverageStop("NATIVE_TRACE_NO_PC_OBSERVATIONS")
    observed_in_rom = {addr for addr in observed if 0 <= addr < 0x8000}
    if not observed_in_rom:
        raise CoverageStop("NATIVE_TRACE_NO_ROM_PCS")
    if not report_roots.issubset(observed_in_rom | {0}):
        raise CoverageStop("STATIC_ROOTS_NOT_NATIVE_BACKED")
    overlap = observed_in_rom & compiled_pcs
    return {
        "kind": "GNG_AUDIO_B4_Z80_NATIVE_STATIC_COVERAGE_V1",
        "status": "PC_SET_OVERLAP_ONLY_NOT_EXECUTION_PARITY",
        "observed_unique_rom_pcs": len(observed_in_rom),
        "observed_unique_nonrom_pcs": len(observed) - len(observed_in_rom),
        "static_compiled_rom_pcs": len(compiled_pcs),
        "overlap_observed_compiled_pcs": len(overlap),
        "observed_rom_pcs_not_compiled": len(observed_in_rom - compiled_pcs),
        "static_compiled_pcs_not_observed": len(compiled_pcs - observed_in_rom),
        "native_backed_seed_count": len(report_roots),
        "trace_closed": heartbeat["trace_closed"],
        "native_loaded_rom_identity_verified": False,
        "native_trace_instruction_parity_verified": False,
        "irq_service_parity_verified": False,
        "game_audio_working": False,
        "private_artifacts_safe": True,
        "rom_bytes_exported": False,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Private MAME PC trace / static Z80 coverage audit")
    ap.add_argument("--id", required=True)
    ap.add_argument("--report", required=True, help="private report basename, never a path")
    args = ap.parse_args(argv)
    try:
        b3.verify_repository_privacy()
        answer = coverage(args.id, args.report)
        print(json.dumps(answer, separators=(",", ":")))
        return 0
    except (CoverageStop, pc.TraceStop, b3.B3Stop, OSError):
        exc = sys.exc_info()[1]
        reason = str(exc) if isinstance(exc, (CoverageStop, pc.TraceStop, b3.B3Stop)) else "COVERAGE_IO_STOP"
        print(json.dumps({"kind":"GNG_AUDIO_B4_Z80_NATIVE_STATIC_COVERAGE_V1",
                          "status":"STOP", "reason":reason,
                          "private_artifacts_safe":True,
                          "rom_bytes_exported":False}, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    sys.exit(main())
