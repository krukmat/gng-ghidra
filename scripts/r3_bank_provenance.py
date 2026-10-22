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
from r3_bank_inventory import (BANK_COUNT, BANK_SIZE, PACKED_SIZE,
                               assemble_banks, private_destination,
                               count_trace_banked_pcs, analyze_native_bank_samples)

MARK = "GNG_A06_BANKSIG"
SIG = re.compile(r"\bGNG_A06_BANKSIG\s+S0=([0-9A-Fa-f]{2})\s+S1=([0-9A-Fa-f]{2})(?=\s|$)")
PC = re.compile(r"\bGNG_R2_PRE\s+PC=([0-9A-Fa-f]{4})(?=\s)")
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
    for line in raw_trace.splitlines():
        if "GNG_R2_PRE" not in line and MARK not in line:
            continue
        pmatches=list(PC.finditer(line))
        smatches=list(SIG.finditer(line))
        if len(pmatches)!=1 or len(smatches)!=1:
            raise ValueError("A063_TRACE_MARKERS_NOT_SAME_INSTRUCTION")
        position=int(pmatches[0].group(1),16)
        signature=tuple(int(x,16) for x in smatches[0].groups())
        if len(entries)>=len(rows) or rows[len(entries)].get("pc")!=position:
            raise ValueError("A063_PRESTATE_AND_SIGNATURE_PC_NOT_ALIGNED")
        if rows[len(entries)].get("seq")!=len(entries):
            raise ValueError("A063_NATIVE_PRESTATE_SEQUENCE_INVALID")
        bank=lookup.get(signature)
        if bank is None:
            raise ValueError("A063_UNKNOWN_NATIVE_MAPPED_BANK_SIGNATURE")
        entries.append(bank)
    if len(entries)!=len(rows):
        raise ValueError("A063_INCOMPLETE_PER_INSTRUCTION_BANK_TRACE")
    return entries

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
    p.add_argument("mode",choices=("prepare","report"))
    p.add_argument("--zip",type=Path,default=ROOT/"roms/gng.zip")
    p.add_argument("--flat",type=Path,default=ROOT/"out/gngb-flat.bin")
    p.add_argument("--banks",type=Path,default=ROOT/"out/r3/banked-rom/private-banked-rom.bin")
    p.add_argument("--observations",type=Path,default=ROOT/"out/r2/mame-probe/observations.tsv")
    p.add_argument("--trace",type=Path,default=ROOT/"out/r2/mame-probe/pre-instruction.jsonl")
    p.add_argument("--rawtrace",type=Path,default=ROOT/"out/r2/mame-probe/cpu.trace")
    p.add_argument("--output",type=Path,default=ROOT/"out/r3/banked-provenance")
    args=p.parse_args()
    try:
        (run_prepare if args.mode=="prepare" else run_report)(args)
    except (ValueError,OSError,KeyError,TypeError,json.JSONDecodeError) as ex:
        p.error(str(ex))
if __name__=="__main__":
    main()
