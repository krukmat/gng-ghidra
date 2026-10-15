#!/usr/bin/env python3
"""ROM-attested ranking of THIRD real Ghidra MC6809 routine candidates.

This is a triage tool, not an eligibility waiver or equivalence proof.
Only the owner's 64-KiB flat ROM and byte-matched Ghidra export are used.
Never infer runtime reachability, DP/S/X/U bounds or hardware semantics.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from function_inventory import verify_raw
from function_ir import normalize_function
from memory_contracts import evaluate
from memory_provenance import profile
from pcode_codegen import compile_function, Unsupported

PREVIOUSLY_DIFFERENTIALLY_TESTED = frozenset({'0x622c', '0x6755'})
NON_LEAF_ROOTS = frozenset({'0x6000', '0x65c4', '0x65fb'})
SCHEMA = 'gng.third-routine-triage.v1'


def assess(function: dict, overlapping_instructions: int = 0,
           incoming_decoded_call: bool = False) -> dict:
    entry = function['entry']
    instructions = function['instructions']
    obligations = evaluate(function)
    accesses = obligations['accesses']
    provenance = profile(function)
    if len(provenance) != len(accesses):
        raise ValueError(f'P-code memory and pointer-provenance mismatch at {entry}')
    buckets = Counter(x['bucket'] for x in provenance)
    mmio = [x for x in accesses if x['hypothetical_classification'] == 'mmio-forbidden']
    rom_writes = [x for x in accesses if x['hypothetical_classification'] == 'rom-write-forbidden']
    unknown = [x for x in accesses if x['hypothetical_classification'] == 'unresolved']
    unsafe = len(mmio) + len(rom_writes) + len(unknown)
    conditional = obligations['conditionally_in_range']

    # A decoded RTS with a P-code RETURN but no S-derived stack read is
    # an incomplete/fabricated model. The 6809 RTS must pop a 16-bit return
    # address. Keep this separate from merely compiling a RETURN opcode.
    rts_instructions = [
        ins for ins in instructions
        if ins['raw'].casefold() == '39' and
        any(p['op'] == 'RETURN' for p in ins.get('pcode', []))
    ]
    modeled_rts = bool(rts_instructions) and all(
        any(x['address'] == ins['address'] and x['operation'] == 'LOAD'
            and x['bucket'] == 'stack-S' for x in provenance)
        for ins in rts_instructions
    )
    opcodes = Counter(p['op'] for i in instructions for p in i.get('pcode', []))
    calls = opcodes['CALL'] + opcodes['CALLIND']
    interrupts = [i for i in instructions if
                  i.get('pcode_status') == 'unmodeled-wait-for-interrupt']
    bank_switch = [i['address'] for i in instructions
                   if i['raw'].casefold() in ('b73e00', 'f73e00')]
    # Use existing normalization and emitter to expose *actual* structural
    # blockers. Code emission success is NOT a memory proof.
    compile_blocker = None
    try:
        compile_function(normalize_function(function))
    except (Unsupported, ValueError, KeyError, TypeError) as e:
        compile_blocker = str(e)

    blockers = []
    if entry in PREVIOUSLY_DIFFERENTIALLY_TESTED:
        blockers.append('already-under-differential-tests')
    if entry in NON_LEAF_ROOTS:
        blockers.append('reset-or-IRQ-or-bank-dispatch-root')
    if interrupts:
        blockers.append('wait-for-interrupt')
    if calls:
        blockers.append('has-calls; interprocedural control required')
    if bank_switch:
        blockers.append('writes-bank-select-register')
    if compile_blocker:
        blockers.append('P-code/CFG compiler: ' + compile_blocker)
    if not modeled_rts:
        blockers.append('no validated RTS P-code pop from S')
    if overlapping_instructions:
        blockers.append('overlapping exported Ghidra CFG instructions: ' +
                        str(overlapping_instructions))
    if mmio:
        blockers.append(f'{len(mmio)} fixed/dynamic MMIO access(es): needs board contract')
    if rom_writes:
        blockers.append(f'{len(rom_writes)} ROM write(s) forbidden')
    if unknown:
        blockers.append(f'{len(unknown)} unresolved pointer(s): needs bounded proof')

    # These classifications are *experimental candidate priorities*, not
    # assertions about game entry conditions or CPU functional equivalence.
    structurally_ready = (not compile_blocker and not calls and
                          not interrupts and not bank_switch and modeled_rts
                          and not overlapping_instructions)
    conditional_pure = (structurally_ready and not blockers and
                        conditional == len(accesses))
    if entry in PREVIOUSLY_DIFFERENTIALLY_TESTED:
        status = 'ALREADY_TESTED'
    elif entry in NON_LEAF_ROOTS:
        status = 'EXCLUDED_ROOT'
    elif not structurally_ready:
        status = 'STRUCTURAL_BLOCK'
    elif mmio or rom_writes:
        status = 'NEEDS_BOARD_CONTRACT'
    elif unknown:
        status = 'NEEDS_REGISTER_BOUNDS'
    elif conditional_pure:
        status = 'POTENTIAL_CONDITIONAL_PURE_LEAF'
    else:
        status = 'NEEDS_REVIEW'

    index_accesses = sum(n for bucket, n in buckets.items()
                         if 'index-X' in bucket or 'index-Y' in bucket or
                         'index-U' in bucket or 'mixed-' in bucket)
    priority = (
        1000
        - (600 if not structurally_ready else 0)
        - (900 if entry in NON_LEAF_ROOTS else 0)
        - (900 if entry in PREVIOUSLY_DIFFERENTIALLY_TESTED else 0)
        - (45 if not incoming_decoded_call else 0)
        - 60 * len(rom_writes)
        - 30 * len(mmio)
        - 12 * len(unknown)
        - 8 * index_accesses
        - min(len(instructions), 150)
    )
    return {
        'entry': entry, 'status': status, 'priority': priority,
        'instruction_count': len(instructions),
        'pcode_ops': dict(sorted(opcodes.items())),
        'structural_compile_possible': compile_blocker is None,
        'modeled_6809_rts_stack_pop': modeled_rts,
        'overlapping_exported_instruction_count': overlapping_instructions,
        'decoded_incoming_call_provenance': incoming_decoded_call,
        'structural_block_reason': compile_blocker,
        'conditional_hypothesis': 'DP=0 at every instruction; 0x100<=S<=0x2ffc',
        'memory_total': len(accesses),
        'conditionally_in_ram_or_rom': conditional,
        'mmio_access_count': len(mmio),
        'rom_write_count': len(rom_writes),
        'unresolved_pointer_count': len(unknown),
        'index_dependent_accesses': index_accesses,
        'pointer_buckets': dict(sorted(buckets.items())),
        'mmio_sites': [
            {'instruction': x['instruction'], 'operation': x['operation'],
             'address_interval': x['address_interval'],
             'width_bytes': x['width_bytes']}
            for x in mmio
        ],
        'unresolved_examples': [
            {'instruction': x['instruction'], 'pointer': x['pointer'],
             'operation': x['operation']}
            for x in unknown[:4]
        ],
        'blockers': blockers,
        'conditional_pure_eligibility_proven': False,
        'game_reachability_proven': False,
        'native_6809_equivalence_verified': False,
    }


def rank(raw: dict, image: bytes) -> dict:
    verify_raw(raw, image)
    # Overlapping instruction boundaries across exported graphs make
    # independent function boundaries unproven, even when P-code compiles.
    owners = {}
    for f in raw['functions']:
        for ins in f['instructions']:
            owners.setdefault(ins['address'],set()).add(f['entry'])
    shared = {
        f['entry']:sum(len(owners[i['address']])>1 for i in f['instructions'])
        for f in raw['functions']
    }
    from function_inventory import direct_call_records
    incoming = {x['target'] for f in raw['functions']
                for x in direct_call_records(f)}
    incoming.update(x['target'] for x in raw.get('anchored_verified_calls', []))
    items = [assess(f, shared[f['entry']], f['entry'] in incoming)
             for f in raw['functions']]
    items.sort(key=lambda x: (-x['priority'], x['instruction_count'], x['entry']))
    return {
        'schema': SCHEMA,
        'rom_sha256': hashlib.sha256(image).hexdigest(),
        'source_export_schema': raw['schema'],
        'source_function_count': len(raw['functions']),
        'status': 'RANKED_NOT_ELIGIBILITY_VERIFIED',
        'assumptions_not_proven': [
            'Call site reachability',
            'Entry DP, S and index-register bounds',
            'Board/MMIO effects beyond known contracts',
            'Whole-game bank and IRQ execution context',
            'Independent MC6809 functional equivalence',
        ],
        'candidates': items,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image', type=Path, default=Path('out/gngb-flat.bin'))
    parser.add_argument('--out', type=Path,
                        default=Path('out/third-routine-candidates.json'))
    parser.add_argument('--limit', type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.limit <= 25:
        parser.error('limit must be 1..25')
    report = rank(json.loads(args.input.read_text()), args.rom_image.read_bytes())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('GNG_THIRD_ROUTINE_TRIAGE=RANKED_NOT_ELIGIBILITY_VERIFIED ' +
          'functions=' + str(report['source_function_count']))
    for f in report['candidates'][:args.limit]:
        print('  '+f['entry']+' '+f['status']+
              ' inst='+str(f['instruction_count'])+
              ' mem='+str(f['conditionally_in_ram_or_rom'])+
              '/'+str(f['memory_total'])+
              ' mmio='+str(f['mmio_access_count'])+
              ' unresolved='+str(f['unresolved_pointer_count'])+
              ' index='+str(f['index_dependent_accesses'])+
              ' compiler='+('READY' if f['structural_compile_possible'] else 'BLOCKED'))
        for b in f['blockers'][:2]:
            print('    '+b)
    print('GNG_THIRD_ROUTINE_ACCEPTANCE=NOT_ESTABLISHED ranking is static only')
    print('GNG_THIRD_ROUTINE_REPORT='+str(args.out))


if __name__ == '__main__':
    main()
