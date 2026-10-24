#!/usr/bin/env python3
"""A0.6.3 private instruction-boundary bank oracle, never a public trace.

The MAME 0.289 diagnostic gng driver exposes live mainbank.entry as a
read-only CPU debugger symbol. In the same tracelog callback, independent
b@ reads fingerprint the active bank. Both must agree for EVERY prestate.
A passing short smoke is not certification of the full A0.6.3 workload.
"""
from __future__ import annotations
import json
import os
import re
from pathlib import Path

from a063_capture_integrity import verify_postflight
from r3_bank_provenance import (load_authenticated_images,
                                choose_signature_offsets,
                                parse_debugger_bank_signatures)
from r3_bank_inventory import analyze_native_bank_samples

ROOT=Path(__file__).resolve().parents[1]
MARK="GNG_A063_ENTRY"
ORACLE=re.compile(r"\bGNG_A063_ENTRY\s+E=\s*(?:0[xX])?([0-9A-Fa-f]{1,16})(?=\s|$|[^0-9A-Za-z_])")
SCHEMA="gng.a063.private-instruction-bank-oracle.v1"

def parse_driver_entries(raw_trace: str, rows: list[dict]) -> list[int]:
    """Reject missing, duplicated, malformed, wide or orphaned bank markers."""
    if not isinstance(raw_trace,str) or not isinstance(rows,list):
        raise ValueError("A063_ORACLE_TRACE_INPUT_INVALID")
    entries=[]
    for line in raw_trace.splitlines():
        if MARK not in line and "GNG_R2_PRE" not in line:
            continue
        if (line.count("GNG_R2_PRE")!=1 or line.count(MARK)!=1
            or len(re.findall(r"\bE\s*=",line))!=1):
            raise ValueError("A063_ORACLE_MISSING_OR_DUPLICATE_MARKER")
        matches=list(ORACLE.finditer(line))
        if len(matches)!=1:
            raise ValueError("A063_ORACLE_MALFORMED_VALUE")
        entry=int(matches[0].group(1),16)
        if entry>4:
            raise ValueError("A063_ORACLE_BANK_OUT_OF_RANGE")
        entries.append(entry)
    if not entries or len(entries)!=len(rows):
        raise ValueError("A063_ORACLE_INSTRUCTION_COUNT_MISMATCH")
    return entries

def compare(rom_banks: list[int], live_banks: list[int], samples: dict)->dict:
    """Compare observations in strict 1:1 order; no frame interpolation."""
    if (not rom_banks or len(rom_banks)!=len(live_banks) or
        any(type(x) is not int or x<0 or x>4 for x in (*rom_banks,*live_banks))):
        raise ValueError("A063_ORACLE_ENTRY_SEQUENCE_INVALID")
    mismatches=sum(a!=b for a,b in zip(rom_banks,live_banks))
    if mismatches:
        raise ValueError("A063_ORACLE_ROM_BANK_DISAGREEMENT")
    writes=samples.get("sampled_control_writes_before_handler")
    resets=samples.get("native_soft_reset_notifications",0)
    invalid=samples.get("unparseable_native_bank_samples",0)
    total=samples.get("total_bank_control_writes",writes)
    if (type(writes) is not int or writes<0 or type(resets) is not int or resets<0
        or type(invalid) is not int or invalid<0
        or type(total) is not int or total<writes):
        raise ValueError("A063_ORACLE_WRITE_OR_RESET_SAMPLE_INVALID")
    if invalid:
        raise ValueError("A063_ORACLE_NATIVE_SAMPLES_INVALID")
    transitions=sum(before!=after for before,after in zip(rom_banks,rom_banks[1:]))
    # A bank may stay selected after a control write, but it cannot
    # change without a write unless reset intervenes. This is a
    # consistency bound, NOT per-edge attribution from frame samples.
    if ("total_bank_control_writes" in samples and not resets
            and transitions > total):
        raise ValueError("A063_ORACLE_TRANSITIONS_EXCEED_CONTROL_WRITES")
    distinct=len(set(rom_banks))
    if len(rom_banks)<256:
        status="INCONCLUSIVE_TOO_FEW_PRESTATES"
    elif distinct<2 or writes<1 or resets:
        status="INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION"
    else:
        status="A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063"
    return {
        "schema":SCHEMA,
        "status":status,
        "native_prestate_count":len(rom_banks),
        "rom_pair_vs_live_bank_comparisons":len(rom_banks),
        "rom_pair_vs_live_bank_mismatch_count":0,
        "distinct_authentic_banks_observed":distinct,
        "native_bank_control_write_samples":writes,
        "native_bank_control_write_count":total,
        "observed_instruction_bank_transitions":transitions,
        "unparseable_native_bank_samples":invalid,
        "native_soft_reset_notifications":resets,
        "live_bank_entry_read_at_instruction_boundary":True,
        "native_bank_per_instruction_full_run_proven":False,
        "native_full_r2_execution_equivalence_proven":False,
        "raw_rom_cpu_register_trace_or_bank_sequence_exported":False,
        "truncation_or_lowbyte_mask_accepted":False,
    }

def evaluate(root: Path)->dict:
    root=root.resolve()
    out=root/"out/r3/a063-oracle-smoke"
    pre=root/"out/r3/a063-oracle-preflight/private-a063-preflight.json"
    verify_postflight(root,out,pre,mame_bin=os.environ.get("GNG_R3_MAME_BIN"))
    plan=json.loads(pre.read_text(encoding="utf-8"))
    if plan.get("oracle_mode") is not True:
        raise ValueError("A063_ORACLE_PREFLIGHT_MODE_MISSING")
    packed,_=load_authenticated_images(root/"roms/gng.zip",
        root/"out/gngb-flat.bin",
        root/"out/r3/banked-rom/private-banked-rom.bin")
    manifest=json.loads((root/"out/r3/banked-provenance/private-signature-offsets.json").read_text(encoding="utf-8"))
    offsets=tuple(manifest["offsets"])
    if offsets!=choose_signature_offsets(packed):
        raise ValueError("A063_ORACLE_PRIVATE_OFFSETS_INVALID")
    rows=[json.loads(line) for line in
          (out/"pre-instruction.jsonl").read_text(encoding="utf-8").splitlines()
          if line]
    trace=(out/"cpu.trace").read_text(encoding="utf-8")
    rom_banks=parse_debugger_bank_signatures(trace,rows,packed,offsets)
    live_banks=parse_driver_entries(trace,rows)
    samples=analyze_native_bank_samples((out/"observations.tsv").read_text(encoding="utf-8"))
    result=compare(rom_banks,live_banks,samples)
    with (out/"private-a063-oracle-check.json").open("x",encoding="utf-8") as stream:
        json.dump(result,stream,indent=2,sort_keys=True)
        stream.write("\n")
    os.chmod(out/"private-a063-oracle-check.json",0o600)
    return result

def main()->None:
    try:
        result=evaluate(ROOT)
    except (ValueError,OSError,KeyError,TypeError,json.JSONDecodeError) as exc:
        raise SystemExit("A063_ORACLE=BLOCKED invalid_private_instruction_oracle_evidence") from exc
    print("A063_ORACLE="+result["status"])
    if result["status"]!="A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063":
        raise SystemExit(2)

if __name__=="__main__":
    main()
