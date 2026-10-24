#!/usr/bin/env python3
"""A0.6.3-R1: ROM-free contract for native MAME trace capture.

Never certifies native bank provenance. Validates trace-action structure,
records a private *pre-run* environment manifest and classifies aggregated
diagnostics. No ROM bytes or native trace are read or exported.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CPU_SYMBOLS=("pc","a","b","x","y","u","s","dp","cc")
CPU_FORMAT="PC=%04X A=%02X B=%02X X=%04X Y=%04X U=%04X S=%04X DP=%02X CC=%02X"
SIGNATURE_FORMAT="GNG_A06_BANKSIG S0=%02X S1=%02X"
ORACLE_FORMAT="GNG_A063_ENTRY E=%02X"
ORACLE_SYMBOL="gng_a063_bank"
SCHEMA="gng.a063.private-capture-preflight.v1"
# Freeze ALL scripts that can change the native trace or its source records.
SOURCE_FILES=(
    "scripts/r2-mame-probe.sh",
    "scripts/r2-mame-probe.lua",
    "scripts/r2_pretrace_report.py",
    "scripts/r2_probe_report.py",
    "scripts/r3-bank-provenance-capture.sh",
    "scripts/r3_bank_provenance.py",
    "scripts/r3_bank_inventory.py",
    "scripts/prepare_r3_flat_rom.py",
    "scripts/a063_smoke_signature_gate.py",
    "scripts/a063_bank_oracle_gate.py",
    "scripts/a063_patch_mame_oracle.py",
    "patches/mame0289-a063-bank-oracle.patch",
    "scripts/a063-native-oracle-miniprobe.sh",
    "scripts/a063-native-miniprobe.sh",
    "scripts/a063_capture_integrity.py",
    "scripts/a063_trace_contract.py",
)
DIAGNOSTIC_SCHEMA="gng.a06.bank-trace-shape-diagnostic.v1"
ADDRESS=re.compile(r"[0-9a-fA-F]{4}\Z",re.ASCII)

class ContractError(ValueError):
    """A redacted fail-closed error that never includes probe addresses."""

def validate_offsets(first: str,second: str) -> tuple[int,int]:
    if not isinstance(first,str) or not isinstance(second,str):
        raise ContractError("A063_R1_OFFSET_FORMAT_INVALID")
    if not ADDRESS.fullmatch(first) or not ADDRESS.fullmatch(second):
        raise ContractError("A063_R1_OFFSET_FORMAT_INVALID")
    x,y=int(first,16),int(second,16)
    if x==y or not (0x4000<=x<=0x5fff and 0x4000<=y<=0x5fff):
        raise ContractError("A063_R1_OFFSET_SCOPE_INVALID")
    return x,y

def build_action(first: str,second: str, *, oracle: bool=False) -> str:
    """One debugger trace action; optional live driver bank.entry oracle."""
    a,b=validate_offsets(first,second)
    extra=" "+ORACLE_FORMAT if oracle else ""
    specifiers=re.findall(r"%(?:0[24])X",CPU_FORMAT+" "+SIGNATURE_FORMAT+extra)
    if len(specifiers)!=(12 if oracle else 11) or len(CPU_SYMBOLS)!=9:
        raise ContractError("A063_R2_FORMAT_ARITY_INVALID")
    symbols=(*CPU_SYMBOLS,f"b@{a:04x}",f"b@{b:04x}")
    args=",".join((*symbols,ORACLE_SYMBOL) if oracle else symbols)
    return ('{tracelog "GNG_R2_PRE '+CPU_FORMAT+" "+SIGNATURE_FORMAT+extra+'",'+args+'}')

def validate_action(action: str,first: str,second: str, *, oracle: bool=False) -> None:
    if action!=build_action(first,second,oracle=oracle):
        raise ContractError("A063_R1_TRACE_ACTION_MISMATCH")
    if action.count("tracelog")!=1 or "tracesym" in action or "&" in action:
        raise ContractError("A063_R1_TRACE_ACTION_MISMATCH")

def _digest(path: Path) -> str:
    sha=hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024*1024),b""):
            sha.update(block)
    return sha.hexdigest()

def create_preflight(first: str,second: str,mame_bin: str,output: Path,*,
                     root: Path=ROOT,oracle: bool=False) -> dict:
    """Bind action and emulator to local sources BEFORE the native run."""
    action=build_action(first,second,oracle=oracle)
    validate_action(action,first,second,oracle=oracle)
    resolved_root=root.resolve()
    private_root=(resolved_root/"out"/"r3").resolve()
    destination=output.resolve()
    if not destination.is_relative_to(private_root) or destination==private_root:
        raise ContractError("A063_R1_PRIVATE_MANIFEST_LOCATION_REQUIRED")
    if not destination.name.startswith("private-") or destination.suffix!=".json":
        raise ContractError("A063_R1_PRIVATE_MANIFEST_LOCATION_REQUIRED")
    executable=shutil.which(mame_bin)
    if not executable:
        raise ContractError("A063_R1_MAME_UNAVAILABLE")
    executable_path=Path(executable).resolve()
    try:
        version=subprocess.run([str(executable_path),"-version"],
                               text=True,capture_output=True,timeout=15,check=True)
    except (subprocess.SubprocessError,OSError) as exc:
        raise ContractError("A063_R1_MAME_VERSION_UNAVAILABLE") from exc
    version_line=(version.stdout or version.stderr).splitlines()
    if not version_line or not version_line[0].strip() or len(version_line[0])>150:
        raise ContractError("A063_R1_MAME_VERSION_UNAVAILABLE")
    if oracle and not re.search(r"(?<![0-9])0\.289(?![0-9])",version_line[0]):
        raise ContractError("A063_ORACLE_REQUIRES_MAME_0289")
    source_files=SOURCE_FILES
    try:
        source_hashes={name:_digest(resolved_root/name) for name in source_files}
        emulator_sha=_digest(executable_path)
    except OSError as exc:
        raise ContractError("A063_R1_SOURCE_HASH_UNAVAILABLE") from exc
    manifest={
        "schema":SCHEMA,
        "status":"A063_R1_PREFLIGHT_ONLY_NOT_NATIVE_PROVENANCE",
        "emulator_version":version_line[0].strip(),
        "emulator_binary_sha256":emulator_sha,
        "trace_action_sha256":hashlib.sha256(action.encode("utf-8")).hexdigest(),
        "source_sha256":source_hashes,
        "cpu_expression_count":9,
        "bank_signature_expression_count":2,
        "bank_reads_are_byte_expressions":True,
        "native_capture_was_executed":False,
        "bank_identity_per_instruction_proven":False,
        "raw_addresses_rom_bytes_and_traces_exported":False,
    }
    if oracle:
        manifest["oracle_mode"]=True
        manifest["oracle_driver_symbol"]=ORACLE_SYMBOL
        manifest["oracle_bank_entry_expression_count"]=1
    destination.parent.mkdir(parents=True,exist_ok=True)
    serialized=json.dumps(manifest,sort_keys=True,indent=2)+"\n"
    if destination.exists():
        if destination.read_text(encoding="utf-8")!=serialized:
            raise ContractError("A063_R1_STALE_CAPTURE_PREFLIGHT_MANIFEST")
    else:
        with destination.open("x",encoding="utf-8") as f:
            f.write(serialized)
    os.chmod(destination,0o600)
    return manifest

def classify_diagnostic(data: dict) -> dict:
    """Aggregate-only triage; an 8-bit mask is NEVER accepted as proof."""
    if not isinstance(data,dict) or data.get("schema")!=DIAGNOSTIC_SCHEMA:
        raise ContractError("A063_R1_DIAGNOSTIC_SCHEMA_INVALID")
    keys=("native_prestate_count","trace_lines_with_cpu_pre_marker",
          "trace_lines_with_bank_signature_marker","trace_lines_with_both_markers",
          "trace_lines_with_formatted_cpu_pc_and_pair","native_pair_width_out_of_byte_range",
          "first_signature_values_exceed_byte","second_signature_values_exceed_byte",
          "matched_format_pc_mismatch_count","matched_format_cpu_register_mismatch_count",
          "matched_format_original_trace_line_mismatch_count")
    if any(type(data.get(k)) is not int or data[k]<0 for k in keys):
        raise ContractError("A063_R1_DIAGNOSTIC_COUNTER_INVALID")
    n=data["native_prestate_count"]
    same=data["trace_lines_with_both_markers"]
    formatted=data["trace_lines_with_formatted_cpu_pc_and_pair"]
    overflow=data["native_pair_width_out_of_byte_range"]
    if (n<1 or same>data["trace_lines_with_cpu_pre_marker"]
        or same>data["trace_lines_with_bank_signature_marker"]
        or formatted>same or overflow>formatted
        or data["first_signature_values_exceed_byte"]>overflow
        or data["second_signature_values_exceed_byte"]>overflow
        or max(data[k] for k in keys[-3:])>formatted):
        raise ContractError("A063_R1_DIAGNOSTIC_COUNTER_INCONSISTENT")
    complete=(n==same==formatted==data["trace_lines_with_cpu_pre_marker"]
              ==data["trace_lines_with_bank_signature_marker"])
    aligned=all(data[k]==0 for k in keys[-3:])
    if not complete or not aligned:
        decision="R1_REQUIRE_TRACE_ALIGNMENT_REPAIR"
    elif overflow:
        decision="R1_REQUIRE_NATIVE_READ_CAUSE_ISOLATION"
    else:
        decision="R1_READY_FOR_PRIVATE_STRICT_PARSER_ONLY"
    return {
        "schema":"gng.a063.r1-redacted-triage.v1",
        "decision":decision,
        "trace_fully_shape_aligned":complete and aligned,
        "invalid_byte_pair_count":overflow,
        "native_provenance_verified":False,
        "lowbyte_mask_accepted_as_proof":False,
        "raw_data_exported":False,
    }

def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest="mode",required=True)
    for mode in ("emit","validate","preflight"):
        p=commands.add_parser(mode)
        p.add_argument("--first",required=True)
        p.add_argument("--second",required=True)
        p.add_argument("--oracle",action="store_true",
                       help="requires diagnostic MAME driver bank.entry symbol")
        if mode=="preflight":
            p.add_argument("--mame-bin",default="mame")
            p.add_argument("--output",type=Path,
                default=ROOT/"out/r3/banked-provenance/private-a063-preflight.json")
    p=commands.add_parser("triage")
    p.add_argument("--input",type=Path,required=True,
                   help="existing redacted diagnostic JSON only")
    args=parser.parse_args()
    try:
        if args.mode=="emit":
            print(build_action(args.first,args.second,oracle=args.oracle))
        elif args.mode=="validate":
            validate_action(build_action(args.first,args.second,oracle=args.oracle),
                            args.first,args.second,oracle=args.oracle)
            print("A063_R1_TRACE_CONTRACT=PASS_ROM_FREE")
        elif args.mode=="preflight":
            create_preflight(args.first,args.second,args.mame_bin,args.output,
                             oracle=args.oracle)
            print("A063_R1_PREFLIGHT=PASS_NOT_NATIVE_PROVENANCE")
        else:
            print(json.dumps(
                classify_diagnostic(json.loads(args.input.read_text(encoding="utf-8"))),
                indent=2))
    except (ContractError,ValueError,OSError,json.JSONDecodeError) as exc:
        parser.error(str(exc) if isinstance(exc,ContractError) else "A063_R1_INPUT_INVALID")

if __name__=="__main__":
    main()
