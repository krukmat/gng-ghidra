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
RESET_MARK="GNG_A063_RESET"
RESET=re.compile(r"\s*GNG_A063_RESET EPOCH=([1-9][0-9]*)\s*\Z",re.ASCII)
FULL_PASS="A063_FULL_NATIVE_BANK_PROVENANCE_PASS"

def parse_driver_entries(raw_trace: str, rows: list[dict]) -> list[int]:
    """Reject missing, duplicated, malformed, wide or orphaned bank markers."""
    if not isinstance(raw_trace,str) or not isinstance(rows,list):
        raise ValueError("A063_ORACLE_TRACE_INPUT_INVALID")
    entries=[]
    for line in raw_trace.splitlines():
        if MARK not in line and "GNG_R2_PRE" not in line:
            continue
        if (line.count("GNG_R2_PRE")!=1 or line.count(MARK)!=1
            or len(re.findall(r"\bE\s*=",line,re.I))!=1):
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

def parse_full_epochs(raw_trace: str, rows: list[dict], observations: str) -> list[int]:
    """Bind epochs to explicit debugger reset delimiters, never PCs or frames.

    Lua's observed reset notifier emits the trace delimiter AND a TSV epoch
    row. Neither a frame sample nor a familiar reset-vector PC is a delimiter.
    Full D6 captures require exactly one requested and observed soft reset.
    """
    if not rows or not isinstance(raw_trace,str) or not isinstance(observations,str):
        raise ValueError("A063_FULL_EPOCH_INPUT_INVALID")
    epochs=[]
    epoch=0
    occupied=False
    for line_no,line in enumerate(raw_trace.splitlines(),1):
        if RESET_MARK in line:
            match=RESET.fullmatch(line)
            if (not match or not occupied or int(match.group(1))!=epoch+1
                    or "GNG_R2_PRE" in line or MARK in line):
                raise ValueError("A063_FULL_RESET_DELIMITER_INVALID")
            epoch+=1
            occupied=False
        elif "GNG_R2_PRE" in line:
            if (len(epochs)>=len(rows)
                    or type(rows[len(epochs)].get("trace_line")) is not int
                    or rows[len(epochs)].get("trace_line")!=line_no):
                raise ValueError("A063_FULL_PRESTATE_TRACE_LINE_REQUIRED")
            epochs.append(epoch)
            occupied=True
    if len(epochs)!=len(rows) or not occupied or epoch!=1:
        raise ValueError("A063_FULL_RESET_EPOCH_COVERAGE_INVALID")
    records=[line.split("\t") for line in observations.splitlines() if line]
    def values(tag):
        return [record[1:] for record in records if record[0]==tag]
    if (values("A063_ORACLE_RESET_EPOCH") != [["1"]]
            or len(values("RESET_NOTIFICATION"))!=1
            or any(len(args)!=2 for args in values("RESET_NOTIFICATION"))
            or values("OBSERVED_RESET_COUNT") != [["1"]]
            or values("CONTROLLED_SOFT_RESET_REQUESTED") != [["1"]]
            or len(values("SOFT_RESET_REQUESTED"))!=1
            or len(values("SOFT_RESET_REQUESTED")[0])!=2):
        raise ValueError("A063_FULL_RESET_OBSERVATIONS_NOT_ALIGNED")
    # The independently observed reset notification must precede its epoch
    # record. Values sampled by callbacks never attribute a CPU instruction.
    reset_positions=[i for i,r in enumerate(records) if r[0]=="RESET_NOTIFICATION"]
    epoch_positions=[i for i,r in enumerate(records) if r[0]=="A063_ORACLE_RESET_EPOCH"]
    requested_positions=[i for i,r in enumerate(records) if r[0]=="SOFT_RESET_REQUESTED"]
    if not requested_positions[0]<reset_positions[0]<epoch_positions[0]:
        raise ValueError("A063_FULL_RESET_OBSERVATION_ORDER_INVALID")
    return epochs

def compare_full(rom_banks: list[int], live_banks: list[int], rows: list[dict],
                 epochs: list[int], fixed: bytes, packed: bytes,
                 observations: str) -> dict:
    """Full per-prestate comparison and ROM-attested post-selector edges.

    Reset boundaries are excluded before interpreting any bank change. The
    supported selector proof is an authentic STA/STB extended $3e00 followed
    immediately by its next prestate in the SAME epoch. No tap PC/frame is
    used as an instruction identifier.
    """
    if (not rom_banks or len(rom_banks)!=len(live_banks)
            or len(rows)!=len(rom_banks) or len(epochs)!=len(rows)
            or len(fixed)!=65536 or len(packed)!=5*8192
            or any(type(x) is not int or not 0<=x<=4
                   for x in (*rom_banks,*live_banks))):
        raise ValueError("A063_FULL_ENTRY_SEQUENCE_INVALID")
    if rom_banks!=live_banks:
        raise ValueError("A063_ORACLE_ROM_BANK_DISAGREEMENT")
    if (set(epochs)!={0,1} or epochs!=sorted(epochs)
            or any(type(e) is not int for e in epochs)):
        raise ValueError("A063_FULL_RESET_EPOCH_SEQUENCE_INVALID")
    samples=analyze_native_bank_samples(observations)
    if (samples["native_soft_reset_notifications"]!=1
            or samples["unparseable_native_bank_samples"]):
        raise ValueError("A063_FULL_NATIVE_SAMPLES_INVALID")
    transitions=confirmed=selectors=reset_changes=0
    selector_observations=[]
    covered_epochs={}
    for e in epochs:
        covered_epochs[str(e)]=covered_epochs.get(str(e),0)+1
    for i in range(1,len(rows)):
        before,after=rom_banks[i-1],rom_banks[i]
        if epochs[i]!=epochs[i-1]:
            reset_changes+=before!=after
            continue
        prev=rows[i-1]
        pc=prev["pc"]
        # Banked instructions are attested against the authenticated image
        # selected at that instruction; fixed instructions use the flat ROM.
        if 0x4000<=pc<=0x5ffd:
            start=before*8192+pc-0x4000
            instruction=packed[start:start+3]
        elif 0x6000<=pc<=0xfffc:
            instruction=fixed[pc:pc+3]
        else:
            instruction=b""
        selector=(len(instruction)==3 and instruction[0] in (0xb7,0xf7)
                  and instruction[1:]==b"\x3e\x00"
                  and rows[i]["pc"]==pc+3)
        if selector:
            selectors+=1
            value=prev["before"]["A" if instruction[0]==0xb7 else "B"]
            selector_observations.append((epochs[i],value,before))
            expected=4 if value==4 else value&3
            if after!=expected:
                raise ValueError("A063_FULL_POST_SELECTOR_BANK_DISAGREEMENT")
        if before!=after:
            transitions+=1
            if not selector:
                raise ValueError("A063_FULL_UNATTRIBUTED_NON_RESET_BANK_TRANSITION")
            confirmed+=1
    total=samples["total_bank_control_writes"]
    # The tap PC/frame are deliberately ignored. Compare the independently
    # ordered sampled write values to the ROM-attested selector instructions
    # in each explicit epoch. Samples are bounded by the native 64-row cap.
    write_samples=[]
    observed_epoch=0
    for line in observations.splitlines():
        fields=line.split("\t")
        if fields[0]=="A063_ORACLE_RESET_EPOCH":
            observed_epoch=int(fields[1])
        elif fields[0]=="BANK_CONTROL_WRITE_SAMPLE":
            write_samples.append((observed_epoch,int(fields[4]),int(fields[5])))
    complete_write_coverage=(selectors==total and len(write_samples)==min(total,64))
    matching_write_samples=(write_samples==selector_observations[:len(write_samples)])
    if complete_write_coverage and not matching_write_samples:
        raise ValueError("A063_FULL_NATIVE_WRITE_ORDER_OR_DATA_DISAGREEMENT")
    status=(FULL_PASS if len(rows)>=256 and confirmed>=1
            and complete_write_coverage and matching_write_samples
            and samples["sampled_control_writes_before_handler"]>=1
            else "INCONCLUSIVE_FULL_SELECTOR_TRANSITION_COVERAGE")
    return {
        "schema":SCHEMA,"status":status,
        "native_prestate_count":len(rows),
        "rom_pair_vs_live_bank_comparisons":len(rows),
        "rom_pair_vs_live_bank_mismatch_count":0,
        "distinct_authentic_banks_observed":len(set(rom_banks)),
        "native_bank_control_write_samples":samples["sampled_control_writes_before_handler"],
        "native_bank_control_write_count":total,
        "observed_instruction_bank_transitions":transitions,
        "verified_post_selector_bank_transitions":confirmed,
        "verified_selector_poststates":selectors,
        "sampled_native_write_values_and_epochs_match_selectors":matching_write_samples,
        "native_selector_write_count_matches_attested_instructions":selectors==total,
        "native_soft_reset_notifications":1,
        "explicit_reset_epoch_count":2,
        "native_prestate_count_by_epoch":covered_epochs,
        "reset_bank_changes_excluded_from_selector_transitions":reset_changes,
        "all_epochs_compared_without_frame_inference":True,
        "live_bank_entry_read_at_instruction_boundary":True,
        "native_bank_per_instruction_full_run_proven":status==FULL_PASS,
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
