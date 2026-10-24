#!/usr/bin/env python3
"""A0.6.3: bank ID at every native MC6809 pre-instruction boundary.

Stock MAME's debugger trace action reads TWO bank-window bytes using the
side-effect-free b@ expression at each instruction. We select two offsets
that uniquely fingerprint the FIVE CRC-verified gngb bank images.
Compare signatures with the native debugger's trace, then align every
bank signature 1:1 to the existing native prestate JSONL.

This is native bank *mapping* evidence, not proof of all CPU bus accesses,
cold-boot selection, interrupt timing, or a playable game.
Private samples and ROM image are confined to ignored out/r3.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from r2_pretrace_report import FIELDS as NATIVE_CPU_FIELDS, PATTERN as NATIVE_CPU_PATTERN
from r3_bank_inventory import (BANK_COUNT, BANK_SIZE, PACKED_SIZE,
                               assemble_banks, private_destination,
                               count_trace_banked_pcs, analyze_native_bank_samples)

MARK = "GNG_A06_BANKSIG"
# tracelog width is a MINIMUM, not an exact length. Accept 1-16
# hexadecimal digits (optionally 0x-prefixed), then enforce BYTE range.
# Do not silently truncate a debugger expression exceeding 8 bits.
SIG = re.compile(r"\bGNG_A06_BANKSIG\s+S0=\s*(?:0[xX])?([0-9A-Fa-f]{1,16})"
                 r"\s+S1=\s*(?:0[xX])?([0-9A-Fa-f]{1,16})(?=\s|$|[^0-9A-Za-z_])")
PC = re.compile(r"\bGNG_R2_PRE\s+PC=\s*(?:0[xX])?([0-9A-Fa-f]{1,4})(?=\s|$|[^0-9A-Za-z_])")
SCHEMA = "gng.a06.native-bank-per-instruction.v1"

def choose_signature_offsets(packed: bytes) -> tuple[int, int]:
    if len(packed) != PACKED_SIZE:
        raise ValueError("A063_FIVE_VERIFIED_BANKS_REQUIRED")
    banks = [packed[i*BANK_SIZE:(i+1)*BANK_SIZE] for i in range(BANK_COUNT)]
    # Search by five-bank byte-pattern partitions (at most 52 distinct
    # patterns), not 8192^2 candidate positions. Greedy selection of
    # the most discriminating *first* byte can miss a valid pair.
    representatives: dict[tuple[int, ...], int] = {}
    for pos in range(BANK_SIZE):
        pattern = tuple(b[pos] for b in banks)
        representatives.setdefault(pattern, pos)
    locations = sorted(representatives.values())
    for i, first in enumerate(locations):
        for second in locations[i+1:]:
            if len({(b[first], b[second]) for b in banks}) == BANK_COUNT:
                return first, second
    raise ValueError("A063_NO_UNIQUE_TWO_BYTE_BANK_FINGERPRINT")

def signature_to_bank(packed: bytes, offsets: tuple[int,int]) -> dict[tuple[int,int],int]:
    if (len(packed) != PACKED_SIZE or len(offsets) != 2
        or offsets[0] == offsets[1]
        or any(not isinstance(v,int) or not 0 <= v < BANK_SIZE
               for v in offsets)):
        raise ValueError("A063_INVALID_SIGNATURE_CONFIG")
    lookup = {}
    for bank in range(BANK_COUNT):
        signature = (packed[bank*BANK_SIZE+offsets[0]],
                     packed[bank*BANK_SIZE+offsets[1]])
        if signature in lookup:
            raise ValueError("A063_AMBIGUOUS_AUTHENTIC_BANK_SIGNATURE")
        lookup[signature] = bank
    return lookup

def parse_debugger_bank_signatures(raw_trace: str, rows: list[dict],
                                   packed: bytes, offsets: tuple[int,int]) -> list[int]:
    if not isinstance(raw_trace,str) or not isinstance(rows,list):
        raise ValueError("A063_MISSING_NATIVE_CPU_TRACE")
    lookup = signature_to_bank(packed, offsets)
    entries=[]
    for trace_line_number,line in enumerate(raw_trace.splitlines(),1):
        if "GNG_R2_PRE" not in line and MARK not in line:
            continue
        pmatches=list(PC.finditer(line))
        smatches=list(SIG.finditer(line))
        cpu_matches=list(NATIVE_CPU_PATTERN.finditer(line))
        # The fingerprint and all nine CPU registers must be from the
        # same native debugger line; matching only PC is insufficient.
        if (line.count("GNG_R2_PRE")!=1 or line.count(MARK)!=1
            or len(pmatches)!=1 or len(smatches)!=1
            or len(cpu_matches)!=1):
            raise ValueError("A063_TRACE_MARKERS_NOT_SAME_INSTRUCTION")
        position=int(pmatches[0].group(1),16)
        signature=tuple(int(x,16) for x in smatches[0].groups())
        if any(value > 255 for value in signature):
            raise ValueError("A063_NATIVE_SIGNATURE_EXCEEDS_BYTE")
        if len(entries)>=len(rows):
            raise ValueError("A063_PRESTATE_AND_SIGNATURE_PC_NOT_ALIGNED")
        row=rows[len(entries)]
        if row.get("pc")!=position:
            raise ValueError("A063_PRESTATE_AND_SIGNATURE_PC_NOT_ALIGNED")
        if row.get("seq")!=len(entries):
            raise ValueError("A063_NATIVE_PRESTATE_SEQUENCE_INVALID")
        native_cpu={key:int(value,16) for key,value in
                    zip(NATIVE_CPU_FIELDS,cpu_matches[0].groups())}
        if native_cpu["PC"]!=position or native_cpu!=row.get("before"):
            raise ValueError("A063_NATIVE_CPU_REGISTERS_AND_PRESTATE_NOT_ALIGNED")
        # R2 records physical line numbers. Check when available to
        # distinguish repeated identical PCs across unrelated samples.
        if (row.get("trace_line") is not None
            and row["trace_line"]!=trace_line_number):
            raise ValueError("A063_NATIVE_PRESTATE_TRACE_LINE_NOT_ALIGNED")
        bank=lookup.get(signature)
        if bank is None:
            raise ValueError("A063_UNKNOWN_NATIVE_MAPPED_BANK_SIGNATURE")
        entries.append(bank)
    if len(entries)!=len(rows):
        raise ValueError("A063_INCOMPLETE_PER_INSTRUCTION_BANK_TRACE")
    return entries

def diagnose_trace_signatures(raw_trace: str, rows: list[dict],
                              packed: bytes | None = None,
                              offsets: tuple[int, int] | None = None) -> dict:
    """Redacted source-shape diagnostics only: never show CPU or ROM data."""
    if not isinstance(raw_trace, str) or not isinstance(rows, list):
        raise ValueError("A063_TRACE_DIAGNOSTIC_INPUT_INVALID")
    lookup = (signature_to_bank(packed, offsets)
              if packed is not None and offsets is not None else None)
    pre_lines = sig_lines = same = formatted_pairs = 0
    pre_line_index = -1
    pc_alignment_mismatches = 0
    cpu_pair_checked = 0
    cpu_pair_mismatches = 0
    trace_line_mismatches = 0
    byte_width_exceeds_8 = 0
    per_field_non_byte = [0, 0]
    high_pattern_counts = {"one_or_both_64bit_ones": 0,
                           "one_or_both_32bit_ones": 0,
                           "other_nonbyte": 0,
                           "no_nonbyte": 0}
    candidate_full_value_matches = 0
    candidate_lowbyte_only_matches = 0
    candidate_lowbyte_distinct_banks = set()
    missing_signature_on_pre_line = 0
    signature_without_pre_on_line = 0
    malformed_sample_shapes = []
    for raw_line_number,line in enumerate(raw_trace.splitlines(),1):
        has_pre = "GNG_R2_PRE" in line
        has_sig = MARK in line
        if has_pre:
            pre_lines += 1
            pre_line_index += 1
        if has_sig:
            sig_lines += 1
        if has_pre and not has_sig:
            missing_signature_on_pre_line += 1
        if has_sig and not has_pre:
            signature_without_pre_on_line += 1
        if not (has_pre and has_sig):
            continue
        same += 1
        pcs = list(PC.finditer(line))
        signatures = list(SIG.finditer(line))
        if len(pcs) == len(signatures) == 1:
            formatted_pairs += 1
            values = [int(value, 16) for value in signatures[0].groups()]
            nonbyte = [value > 255 for value in values]
            for j,is_nonbyte in enumerate(nonbyte):
                if is_nonbyte:
                    per_field_non_byte[j] += 1
            if any(nonbyte):
                byte_width_exceeds_8 += 1
            if any(v >> 8 == 0xffffffffffffff for v in values):
                high_pattern_counts["one_or_both_64bit_ones"] += 1
            elif any(v >> 8 == 0xffffff for v in values):
                high_pattern_counts["one_or_both_32bit_ones"] += 1
            elif any(nonbyte):
                high_pattern_counts["other_nonbyte"] += 1
            else:
                high_pattern_counts["no_nonbyte"] += 1
            if lookup is not None:
                pair=tuple(values)
                if pair in lookup:
                    candidate_full_value_matches += 1
                # For diagnosis ONLY. This candidate must never flow
                # into the provenance parser or witness generation.
                candidate=lookup.get(tuple(v & 255 for v in values))
                if candidate is not None:
                    candidate_lowbyte_only_matches += 1
                    candidate_lowbyte_distinct_banks.add(candidate)
            if pre_line_index < len(rows):
                row=rows[pre_line_index]
                if int(pcs[0].group(1),16) != row.get("pc"):
                    pc_alignment_mismatches += 1
                native_cpu=NATIVE_CPU_PATTERN.search(line)
                if native_cpu:
                    cpu_pair_checked += 1
                    parsed={key:int(value,16) for key,value in
                            zip(NATIVE_CPU_FIELDS,native_cpu.groups())}
                    if parsed != row.get("before"):
                        cpu_pair_mismatches += 1
                if (row.get("trace_line") is not None
                    and row["trace_line"] != raw_line_number):
                    trace_line_mismatches += 1
        elif len(malformed_sample_shapes) < 3:
            # Shape-only, no disassembly, addresses, register or byte values.
            malformed_sample_shapes.append({
                "pc_match_count": len(pcs),
                "signature_match_count": len(signatures),
                "s0_token_present": bool(re.search(r"\bS0\s*=", line)),
                "s1_token_present": bool(re.search(r"\bS1\s*=", line)),
                "literal_format_specifier_present": "%02X" in line,
                "comma_after_s0": bool(re.search(r"\bS0\s*=\s*\S+,", line)),
                "line_has_0x_prefix": bool(re.search(r"\bS[01]=0[xX]",line)),
                "trace_line_length": len(line),
            })
    return {
        "schema": "gng.a06.bank-trace-shape-diagnostic.v1",
        "status": "TRACE_SHAPE_ONLY_NOT_PROVENANCE",
        "native_prestate_count": len(rows),
        "trace_lines_with_cpu_pre_marker": pre_lines,
        "trace_lines_with_bank_signature_marker": sig_lines,
        "trace_lines_with_both_markers": same,
        "trace_lines_with_formatted_cpu_pc_and_pair": formatted_pairs,
        "pre_lines_without_signature": missing_signature_on_pre_line,
        "signature_lines_without_pre": signature_without_pre_on_line,
        "native_pair_width_out_of_byte_range": byte_width_exceeds_8,
        "first_signature_values_exceed_byte": per_field_non_byte[0],
        "second_signature_values_exceed_byte": per_field_non_byte[1],
        "nonbyte_upper_bit_shape_counts": high_pattern_counts,
        "private_rom_fingerprint_crosscheck_performed": lookup is not None,
        "native_pairs_matching_full_width_authentic_fingerprint":
            candidate_full_value_matches if lookup is not None else None,
        "native_pairs_matching_authentic_fingerprint_only_after_lowbyte_mask":
            candidate_lowbyte_only_matches if lookup is not None else None,
        "distinct_authentic_bank_candidates_after_lowbyte_mask":
            len(candidate_lowbyte_distinct_banks) if lookup is not None else None,
        "lowbyte_mask_is_proven_safe": False,
        "matched_format_pc_mismatch_count": pc_alignment_mismatches,
        "matched_format_cpu_register_pairs_checked": cpu_pair_checked,
        "matched_format_cpu_register_mismatch_count": cpu_pair_mismatches,
        "matched_format_original_trace_line_mismatch_count": trace_line_mismatches,
        "first_malformed_line_shapes_redacted": malformed_sample_shapes,
        "raw_native_cpu_registers_bank_signature_bytes_or_rom_exported": False,
    }


def analyze_bank_provenance(rows: list[dict], entries: list[int],
                            packed: bytes, fixed: bytes,
                            native_observations: str) -> dict:
    if len(entries)!=len(rows) or len(packed)!=PACKED_SIZE or len(fixed)!=65536:
        raise ValueError("A063_BAD_SOURCE_OR_NATIVE_PRESTATE_COUNT")
    trace="\n".join(json.dumps(row) for row in rows)
    coverage=count_trace_banked_pcs(trace)
    samples=analyze_native_bank_samples(native_observations)
    by_bank=Counter()
    pairs=Counter()
    transitions=[]
    confirmed_at_selector=0
    for i,(row,bank) in enumerate(zip(rows,entries)):
        pc=row["pc"]
        if not 0 <= bank < BANK_COUNT:
            raise ValueError("A063_BANK_ENTRY_INVALID")
        if 0x4000<=pc<=0x5fff:
            by_bank[bank]+=1
            pairs[(bank,pc)]+=1
        if i and bank!=entries[i-1]:
            prev=rows[i-1]
            # Soft reset can change the selected bank without a CPU write:
            # this boundary is not evidence of a bankswitch_w call.
            if prev["pc"]==0x6016 and pc==0x6000:
                continue
            prev_pc=prev["pc"]
            instruction_selector=False
            if 0x6000<=prev_pc<=0xfffc and fixed[prev_pc] in (0xb7,0xf7):
                addr=(fixed[prev_pc+1]<<8)|fixed[prev_pc+2]
                reg="A" if fixed[prev_pc]==0xb7 else "B"
                if addr==0x3e00:
                    v=prev["before"][reg]
                    expected=4 if v==4 else v&3
                    instruction_selector=expected==bank
            if instruction_selector:
                confirmed_at_selector+=1
            transitions.append({
                "from":entries[i-1],"to":bank,
                "preceding_pc":f"0x{prev_pc:04x}",
                "following_pc":f"0x{pc:04x}",
                "preceded_by_ROM_attested_bank_write":instruction_selector
            })
    matched=sum(by_bank.values())
    if matched!=coverage["bank_window_pc_samples"]:
        raise ValueError("A063_BANK_PRESTATE_COVERAGE_COUNT_MISMATCH")
    if samples["unparseable_native_bank_samples"]:
        raise ValueError("A063_NATIVE_BANK_CONTROL_TAP_INVALID")
    return {
        "schema":SCHEMA,
        "status":"BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED",
        "native_preinstruction_samples":len(rows),
        "bank_window_pc_samples":matched,
        "distinct_bank_window_pcs":coverage["distinct_bank_window_pcs"],
        "native_banked_prestate_bank_identified":matched,
        "observed_bank_counts":{str(i):by_bank[i] for i in range(BANK_COUNT)},
        "distinct_observed_bank_pc_pairs":len(pairs),
        "bank_pc_pairs":[{"bank":b,"pc":f"0x{pc:04x}","samples":hits}
                         for ((b,pc),hits) in sorted(pairs.items())],
        "observed_non_reset_bank_transitions":transitions,
        "native_bank_transition_preceded_by_known_selector_store":confirmed_at_selector,
        "observed_native_bank_control_tap_writes":samples["total_bank_control_writes"],
        "original_ROM_bank_images_CRC_validated":True,
        "native_per_instruction_mapped_ROM_signature_verified":True,
        "native_cpu_bus_fetch_transaction_correlated":False,
        "bank_power_on_entry_authenticated":False,
        "IRQ_SYNC_or_game_equivalence_verified":False,
        "game_playable":False,
        "raw_ROM_opcode_or_register_values_exported":False,
        "next_task":"Compile and validate the observed (bank, PC) pairs with generated static JS, then model bank-select MMIO effects and IRQ/SYNC."
    }

def load_authenticated_images(zip_path: Path, flat_path: Path, bank_path: Path):
    authentic, fixed=assemble_banks(zip_path)
    if flat_path.read_bytes()!=fixed or bank_path.read_bytes()!=authentic:
        raise ValueError("A063_PRIVATE_ROM_IMAGE_PROVENANCE_MISMATCH")
    return authentic,fixed

def run_prepare(args):
    packed,_=load_authenticated_images(args.zip,args.flat,args.banks)
    offsets=choose_signature_offsets(packed)
    if not private_destination(args.output):
        raise ValueError("A063_PRIVATE_OUTPUT_REQUIRED")
    args.output.mkdir(parents=True,exist_ok=True)
    manifest=args.output/"private-signature-offsets.json"
    expected={"schema":"gng.a06.private-bank-signature-config.v1",
              "offsets":list(offsets)}
    if manifest.exists():
        if json.loads(manifest.read_text())!=expected:
            raise ValueError("A063_PRIVATE_SIGNATURE_MANIFEST_CHANGED")
    else:
        manifest.write_text(json.dumps(expected)+"\n")
    # Only addresses, never banked ROM *data*, are emitted to the shell.
    print(f"{0x4000+offsets[0]:04x} {0x4000+offsets[1]:04x}")

def run_report(args):
    packed,fixed=load_authenticated_images(args.zip,args.flat,args.banks)
    if not private_destination(args.output):
        raise ValueError("A063_PRIVATE_OUTPUT_REQUIRED")
    manifest=json.loads((args.output/"private-signature-offsets.json").read_text())
    offsets=tuple(manifest["offsets"])
    if offsets!=choose_signature_offsets(packed):
        raise ValueError("A063_SIGNATURE_OFFSETS_NOT_AUTHENTIC")
    rows=[json.loads(line) for line in args.trace.read_text().splitlines() if line]
    entries=parse_debugger_bank_signatures(
        args.rawtrace.read_text(),rows,packed,offsets)
    report=analyze_bank_provenance(
        rows,entries,packed,fixed,args.observations.read_text())
    # Required by the next A0.6.4 bank/PC compilation gate. Stored only
    # inside the private evidence directory, with sequence continuity.
    witness=args.output/"private-bank-per-prestate.jsonl"
    witness.write_text("".join(
        json.dumps({"seq":i,"pc":rows[i]["pc"],"bank":entry},
                   separators=(",",":"))+"\n"
        for i,entry in enumerate(entries)),encoding="utf-8")
    report["private_bank_per_instruction_witness_written"]=True
    # Bind the witness to the exact native capture. A0.6.4 must refuse a
    # report copied from an earlier capture or a modified packed bank image.
    files={
        "flat":args.flat,"banks":args.banks,"trace":args.trace,
        "rawtrace":args.rawtrace,"observations":args.observations,
        "witness":witness,
    }
    fingerprints={name:hashlib.sha256(path.read_bytes()).hexdigest()
                  for name,path in files.items()}
    (args.output/"private-source-manifest.json").write_text(
        json.dumps({"schema":"gng.a06.private-bank-evidence-manifest.v1",
                    "sha256":fingerprints},sort_keys=True)+"\n")
    report["private_evidence_hash_manifest_written"]=True
    (args.output/"report.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode",choices=("prepare","report","diagnose"))
    p.add_argument("--zip",type=Path,default=ROOT/"roms/gng.zip")
    p.add_argument("--flat",type=Path,default=ROOT/"out/gngb-flat.bin")
    p.add_argument("--banks",type=Path,default=ROOT/"out/r3/banked-rom/private-banked-rom.bin")
    p.add_argument("--observations",type=Path,default=ROOT/"out/r2/mame-probe/observations.tsv")
    p.add_argument("--trace",type=Path,default=ROOT/"out/r2/mame-probe/pre-instruction.jsonl")
    p.add_argument("--rawtrace",type=Path,default=ROOT/"out/r2/mame-probe/cpu.trace")
    p.add_argument("--output",type=Path,default=ROOT/"out/r3/banked-provenance")
    args=p.parse_args()
    try:
        if args.mode=="diagnose":
            rows=[json.loads(line) for line in args.trace.read_text().splitlines() if line]
            packed = offsets = None
            config=args.output/"private-signature-offsets.json"
            # Optional offline cross-check against the SAME authenticated
            # ROMs; never print signature values, addresses or bank IDs.
            if config.is_file() and args.zip.is_file() and args.flat.is_file() and args.banks.is_file():
                packed,_=load_authenticated_images(args.zip,args.flat,args.banks)
                offsets=tuple(json.loads(config.read_text())["offsets"])
                if offsets!=choose_signature_offsets(packed):
                    raise ValueError("A063_SIGNATURE_OFFSETS_NOT_AUTHENTIC")
            report=diagnose_trace_signatures(
                args.rawtrace.read_text(),rows,packed,offsets)
            print(json.dumps(report,indent=2))
        else:
            (run_prepare if args.mode=="prepare" else run_report)(args)
    except (ValueError,OSError,KeyError,TypeError,json.JSONDecodeError) as ex:
        p.error(str(ex))
if __name__=="__main__":
    main()
