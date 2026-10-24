#!/usr/bin/env python3
"""A063 R2.B3 synthetic five-bank instruction replay (ROM-free).

Uses the actual R3 native parser and R2.A oracle gate. Data is wholly
invented; NEVER claim these traces came from MAME or authentic ROM.
Only aggregate PASS/FAIL counts leave this program.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from r3_bank_inventory import BANK_COUNT,BANK_SIZE
from r3_bank_provenance import parse_debugger_bank_signatures
from a063_bank_oracle_gate import parse_driver_entries,compare

def build_synthetic_five_banks()->bytes:
    banks=[bytearray(BANK_SIZE) for _ in range(BANK_COUNT)]
    for bank in range(BANK_COUNT):
        banks[bank][0]=bank+1
        banks[bank][1]=0x20+bank*3
    return b"".join(banks)

def fake_capture(banks: list[int])->tuple[str,list[dict]]:
    """Generate ordered nine-register prestates with distinct mapping epochs."""
    rom=build_synthetic_five_banks()
    lines=[]
    rows=[]
    for seq,entry in enumerate(banks):
        pc=0x4000+(seq%64) # intentionally repeated across bank epochs
        cpu={"PC":pc,"A":seq%256,"B":(seq*3)%256,"X":seq%65536,
             "Y":0,"U":0,"S":0,"DP":0,"CC":0}
        rows.append({"schema":"gng.r2.pre-instruction.v1","kind":"pre_instruction",
                     "origin":"mame-native-tracelog","seq":seq,"pc":pc,
                     "trace_line":seq+1,"before":cpu})
        reg=" ".join(f"{key}={cpu[key]:0{width}X}" for key,width in
                     (("PC",4),("A",2),("B",2),("X",4),("Y",4),
                      ("U",4),("S",4),("DP",2),("CC",2)))
        s0=rom[entry*BANK_SIZE]
        s1=rom[entry*BANK_SIZE+1]
        lines.append(f"{pc:04X}: NOP GNG_R2_PRE {reg} "
                     f"GNG_A06_BANKSIG S0={s0:02X} S1={s1:02X} "
                     f"GNG_A063_ENTRY E={entry:02X}")
    return "\n".join(lines),rows

def strict_check(trace: str, rows: list[dict],writes=4,resets=0)->dict:
    rom=build_synthetic_five_banks()
    mapped=parse_debugger_bank_signatures(trace,rows,rom,(0,1))
    actual=parse_driver_entries(trace,rows)
    return compare(mapped,actual,{"sampled_control_writes_before_handler":writes,
                                  "native_soft_reset_notifications":resets})

def replay_cases()->dict:
    ordered=[entry for entry in (4,0,1,2,3) for _ in range(75)]
    trace,rows=fake_capture(ordered)
    cases=[]

    def expected_status(name,trace,rows,status,writes=4,resets=0):
        try:
            actual=strict_check(trace,rows,writes=writes,resets=resets)["status"]
            passed=actual==status
        except (ValueError,KeyError,TypeError):
            passed=False
        cases.append((name,passed))

    def expected_rejection(name,trace,rows):
        try:
            strict_check(trace,rows)
            passed=False
        except ValueError:
            passed=True
        cases.append((name,passed))

    expected_status("five_banks_four_transitions",trace,rows,
                    "A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063")
    expected_status("reset_not_proof",trace,rows,
                    "INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION",resets=1)
    expected_status("zero_write_not_proof",trace,rows,
                    "INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION",writes=0)
    one,onerows=fake_capture([4]*375)
    expected_status("one_bank_not_proof",one,onerows,
                    "INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION")
    small,smallrows=fake_capture(ordered[:40])
    expected_status("short_trace_not_proof",small,smallrows,
                    "INCONCLUSIVE_TOO_FEW_PRESTATES")
    lines=trace.splitlines()
    wrong=lines.copy();wrong[180]=wrong[180].replace("E=01","E=03")
    expected_rejection("one_wrong_live_entry","\n".join(wrong),rows)
    wide=lines.copy();wide[12]=wide[12].replace("S0=05","S0=FFFFFFFFFFFFFF05")
    expected_rejection("sign_extended_rom_byte","\n".join(wide),rows)
    orphan=lines.copy();orphan.insert(22,"GNG_A063_ENTRY E=04")
    expected_rejection("orphan_bank_marker","\n".join(orphan),rows)
    duplicate=lines.copy();duplicate[18]+=" E=04"
    expected_rejection("duplicate_bank_field","\n".join(duplicate),rows)
    missing=lines.copy();missing[19]=missing[19].replace("GNG_A063_ENTRY E=04","")
    expected_rejection("missing_live_bank","\n".join(missing),rows)
    cpu_bad=[dict(v) for v in rows]
    cpu_bad[27]={**cpu_bad[27],"before":{**cpu_bad[27]["before"],"A":0xFE}}
    expected_rejection("same_pc_wrong_register",trace,cpu_bad)
    line_bad=[dict(v) for v in rows]
    line_bad[29]={**line_bad[29],"trace_line":33}
    expected_rejection("stale_trace_line",trace,line_bad)
    truncated=lines[:200]
    expected_rejection("partial_capture","\n".join(truncated),rows)
    shifted=lines.copy();shifted[40]=shifted[40].replace("GNG_A06_BANKSIG","\nGNG_A06_BANKSIG",1)
    expected_rejection("split_instruction_and_signature","\n".join(shifted),rows)
    try:
        strict_check(trace,rows,writes=4,resets=0)
        # This is a positive fixture only. Reject if the native event
        # stream is malformed despite otherwise matching instruction banks.
        strict_check(trace,rows,writes=-1)
        cases.append(("negative_write_samples",False))
    except ValueError:
        cases.append(("negative_write_samples",True))
    try:
        from a063_bank_oracle_gate import compare
        attested=[entry for entry in ordered]
        compare(attested,attested,{
            "sampled_control_writes_before_handler":4,
            "native_soft_reset_notifications":0,
            "unparseable_native_bank_samples":1})
        cases.append(("corrupt_native_sample",False))
    except ValueError:
        cases.append(("corrupt_native_sample",True))
    try:
        from a063_bank_oracle_gate import compare
        compare(ordered,ordered,{
            "sampled_control_writes_before_handler":1,
            "total_bank_control_writes":2,
            "native_soft_reset_notifications":0,
        })
        cases.append(("transitions_exceed_writes",False))
    except ValueError:
        cases.append(("transitions_exceed_writes",True))
    totals={"schema":"gng.a063.r2b-romfree-replay.v1",
            "status":"PASS" if all(passed for _,passed in cases) else "FAIL",
            "cases":len(cases),
            "passed":sum(passed for _,passed in cases),
            "failed_case_names":[name for name,passed in cases if not passed],
            "synthetic_banks":BANK_COUNT,
            "synthetic_trace_only":True,
            "native_bank_provenance_proven":False,
            "rom_zip_or_emulator_required":False}
    return totals

def main()->None:
    result=replay_cases()
    print(json.dumps(result,indent=2))
    if result["status"]!="PASS":
        raise SystemExit(2)

if __name__=="__main__":
    main()
