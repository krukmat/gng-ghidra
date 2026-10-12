#!/usr/bin/env python3
"""Compile a ROM-backed *prefix* of a Ghidra CFG, suspending BEFORE verified 6809 SYNC.

Not an interrupt emulator or a claim of full-function behavioral equivalence.
Unknown control flow, banks, opcodes and memory side effects remain rejected.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from function_ir import integer
from pcode_codegen import Unsupported, compile_function


def region_before_sync(function: dict, stop_before: int, entry: int | None = None) -> dict:
    if function.get('schema') != 'gng.function-ir.v1' or function.get('bank_context') != 'bank4':
        raise Unsupported('Expected bank-4 Ghidra function IR')
    if function.get('truncated'):
        raise Unsupported('Cannot translate a truncated source CFG')
    items = [i for block in function['blocks'] for i in block['instructions']]
    by_pc = {integer(i['address']): i for i in items}
    if len(by_pc) != len(items):
        raise Unsupported('Duplicate instruction addresses')
    barrier = by_pc.get(stop_before)
    if barrier is None or barrier.get('pcode_status') != 'unmodeled-wait-for-interrupt' \
       or barrier.get('raw', '').lower() != '13' or barrier.get('assembly', '').strip().upper() != 'SYNC':
        raise Unsupported('The stop address must be a ROM-verified SYNC instruction')
    if entry is None:
        entry = integer(function['entry'])
    if entry == stop_before or entry not in by_pc:
        raise Unsupported('Entry is missing or equals SYNC barrier')
    # Traverse Ghidra instruction edges; never assume linear neighboring bytes execute.
    pending = [entry]
    visited = set()
    reached_barrier = False
    while pending:
        pc = pending.pop()
        if pc == stop_before:
            reached_barrier = True
            continue
        if pc in visited:
            continue
        item = by_pc.get(pc)
        if item is None:
            raise Unsupported(f'Control flow escapes source CFG at 0x{pc:04x}')
        visited.add(pc)
        transitions = list(item['flows'])
        if item['fallthrough'] is not None:
            transitions.append(item['fallthrough'])
        if not transitions and not any(p['op'] == 'RETURN' for p in item['pcode']):
            raise Unsupported(f'No modeled outgoing edge from 0x{pc:04x}')
        for nxt in transitions:
            if nxt != stop_before and nxt not in by_pc:
                raise Unsupported(f'Unknown path 0x{pc:04x} -> 0x{nxt:04x}')
            pending.append(nxt)
    if not reached_barrier:
        raise Unsupported('SYNC boundary is unreachable from selected entry')
    selected = [by_pc[pc] for pc in sorted(visited)]
    return {
        'schema': function['schema'], 'entry': f'0x{entry:x}',
        'name': function['name'] + '_prefix', 'cpu': function['cpu'],
        'bank_context': function['bank_context'],
        'blocks': [{'id': i['address'], 'instructions': [i]} for i in selected],
        'external_edges': [], 'truncated': False,
        'instruction_count': len(selected), 'stop_before': f'0x{stop_before:x}',
        'source_entry': function['entry'], 'contract': 'bounded-prefix-before-sync',
    }


def compile_region(region: dict) -> str:
    compiled = compile_function(region, boundary_address=integer(region['stop_before']))
    return compiled.replace('// Generated from Ghidra instruction P-code.',
        '// BOUNDED PREFIX ONLY. Stops before SYNC; not complete ROM/function translation.\n'
        '// Generated from Ghidra instruction P-code.', 1)


def as_typescript(js: str) -> str:
    return js.replace('function maxSize(size)', 'function maxSize(size: number)')\
        .replace('function mask(value,size)', 'function mask(value: number,size: number)')\
        .replace('function signed(value,size)', 'function signed(value: number,size: number)')\
        .replace('runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000)',
                 'runRoutine(memory: Uint8Array, registers: Uint8Array=new Uint8Array(256), maxSteps: number=10000)')\
        .replace('const tmp=new Map();', 'const tmp=new Map<string, number>();')\
        .replace('return tmp.get(k);', 'return tmp.get(k)!;')\
        .replace('function rd(n)', 'function rd(n: {space:string; offset:number; size:number})')\
        .replace('function wr(n,v)', 'function wr(n: {space:string; offset:number; size:number}, v: number)')\
        .replace('function memRead(addr,size)', 'function memRead(addr: number, size: number)')\
        .replace('function memWrite(addr,size,v)', 'function memWrite(addr: number, size: number, v: number)')


def build(ir: dict, out: Path, entry: int, stop_before: int) -> dict:
    if ir.get('schema') != 'gng.function-ir-bundle.v1':
        raise Unsupported('Expected normalized Ghidra IR bundle')
    candidates = [f for f in ir.get('functions', [])
                  if any(integer(i['address']) == entry for b in f['blocks'] for i in b['instructions'])]
    if len(candidates) != 1:
        raise Unsupported('Expected one containing function for selected entry')
    region = region_before_sync(candidates[0], stop_before, entry)
    js = compile_region(region)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'boot-prefix.mjs').write_text(js)
    (out / 'boot-prefix.ts').write_text(as_typescript(js))
    report = {
        'schema': 'gng.region-proof.v1', 'status': 'generated-not-equivalence-verified',
        'kind': 'prefix-before-sync', 'entry': region['entry'],
        'stop_before': region['stop_before'], 'instruction_count': region['instruction_count'],
        'instruction_addresses': [i['address'] for b in region['blocks'] for i in b['instructions']],
        'runtime_contract': 'stop prior to executing SYNC, return program counter and memory',
        'limitations': ['SYNC/interrupt timing not modeled', 'not a full playable port',
                        'no equivalence claim without reference vectors'],
    }
    (out / 'boot-prefix.report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'GNG_REGION_CODEGEN=PASS entry={region["entry"]} stop_before={region["stop_before"]} instructions={region["instruction_count"]}')
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, required=True)
    ap.add_argument('--out', type=Path, default=Path('out/generated'))
    ap.add_argument('--entry', type=lambda s: int(s, 0), default=0x6000)
    ap.add_argument('--stop-before', type=lambda s: int(s, 0), default=0x6016)
    args = ap.parse_args()
    try:
        build(json.loads(args.input.read_text()), args.out, args.entry, args.stop_before)
    except (ValueError, OSError, KeyError) as exc:
        ap.error(str(exc))


if __name__ == '__main__':
    main()
