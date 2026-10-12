#!/usr/bin/env python3
"""Normalize Ghidra's typed, instruction-level P-code into bank-aware control-flow IR.

Fail closed: no automatic substitution of call targets, unknown memory banks, or
unsupported P-code. Generated code is only eligible for isolated routines.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

SCHEMA = 'gng.function-ir.v1'
ROM_RANGES = ((0x4000, 0x6000), (0x6000, 0x10000))  # 0x4000 bank4 only

# Ghidra 12.1.4 exports the default 6809 memory space as "RAM".  Normalize
# *only* known default P-code spaces, not arbitrary named memory overlays.
KNOWN_SPACES = frozenset({'const', 'ram', 'register', 'unique'})

def canonical_space(raw: str) -> str:
    if not isinstance(raw, str):
        raise ValueError(f'Unsupported varnode space: {raw!r}')
    candidate = raw.casefold()
    if candidate not in KNOWN_SPACES:
        raise ValueError(f'Unsupported varnode space: {raw}')
    return candidate

def canonical_memory_space(raw: str) -> str:
    # A named nondefault LOAD/STORE space stays unsupported by the emitter.
    # Only the Ghidra default RAM space is safely mapped to our flat memory.
    return 'ram' if isinstance(raw, str) and raw.casefold() == 'ram' else raw

def integer(s: str) -> int:
    if not isinstance(s, str) or not s.startswith('0x'):
        raise ValueError(f'Expected hex address, got {s!r}')
    return int(s, 16)

def node(v: dict) -> dict:
    if set(v) != {'space', 'offset', 'size'}:
        raise ValueError(f'Invalid P-code varnode fields: {v}')
    space = canonical_space(v['space'])
    if not isinstance(v['size'], int) or not 1 <= v['size'] <= 8:
        raise ValueError(f'Unsupported varnode size: {v}')
    off = integer(v['offset'])
    if off < 0 or off > (1 << 64) - 1:
        raise ValueError('Invalid varnode offset')
    return {'space': space, 'offset': v['offset'], 'size': v['size']}

def normalize_function(func: dict) -> dict:
    raw = func['instructions']
    if not raw or len(raw) > 2500:
        raise ValueError('Empty or excessively large function')
    ins = []
    addresses = set()
    for obj in raw:
        pc = integer(obj['address'])
        if pc in addresses or not (0x4000 <= pc <= 0xffff):
            raise ValueError(f'Duplicate/non-ROM instruction: {obj["address"]}')
        addresses.add(pc)
        length = obj['length']
        bs = bytes.fromhex(obj['raw'])
        if length <= 0 or len(bs) != length or pc + length > 0x10000:
            raise ValueError(f'Invalid instruction length at {pc:04x}')
        micro = []
        for p in obj['pcode']:
            op = p['op']
            if not isinstance(op, str) or not op:
                raise ValueError('Missing P-code opcode')
            micro.append({'op': op, 'output': node(p['output']) if p.get('output') else None,
                          'inputs': [node(x) for x in p['inputs']],
                          **({'space_name': canonical_memory_space(p['space_name'])} if 'space_name' in p else {})})
        status = obj.get('pcode_status', 'native' if micro else 'unmodeled-empty-pcode')
        if not micro:
            if status == 'verified-nop':
                if obj['raw'].lower() != '12' or obj['assembly'].strip().upper() != 'NOP':
                    raise ValueError(f'Invalid NOP provenance for {pc:04x}')
            elif status not in {'unmodeled-wait-for-interrupt', 'unmodeled-empty-pcode'}:
                raise ValueError(f'Invalid empty P-code status for {pc:04x}')
        elif status != 'native':
            raise ValueError(f'Unexpected P-code status for {pc:04x}')
        if status == 'unmodeled-wait-for-interrupt' and obj['raw'].lower() != '13':
            raise ValueError(f'Invalid SYNC provenance for {pc:04x}')
        falls = [integer(obj['fallthrough'])] if obj.get('fallthrough') else []
        flows = [integer(x) for x in obj['flows']]
        ins.append({'address': obj['address'], 'raw': obj['raw'], 'assembly': obj['assembly'],
                    'next': f'0x{pc + length:x}', 'flow_type': obj['flow_type'],
                    'fallthrough': falls[0] if falls else None, 'flows': flows, 'pcode': micro,
                    'pcode_status': status})
    ins.sort(key=lambda i: integer(i['address']))
    pcs = {integer(x['address']) for x in ins}
    entry = integer(func['entry'])
    if entry not in pcs:
        raise ValueError(f'Entry {entry:04x} not present in function body')
    # Instruction-level edges preserve exact flows. Build blocks from leaders.
    leaders = {entry}
    external = []
    for item in ins:
        pc = integer(item['address'])
        destinations = item['flows'] + ([item['fallthrough']] if item['fallthrough'] is not None else [])
        branch_like = any(p['op'] in {'BRANCH', 'CBRANCH', 'BRANCHIND', 'RETURN', 'CALL', 'CALLIND'} for p in item['pcode'])
        for target in destinations:
            if target in pcs:
                if branch_like or target in item['flows']:
                    leaders.add(target)
            else:
                external.append({'source': item['address'], 'target': f'0x{target:04x}',
                                 'flow_type': item['flow_type']})
        if branch_like:
            nxt = pc + len(bytes.fromhex(item['raw']))
            if nxt in pcs:
                leaders.add(nxt)
    blocks = []
    current = None
    for item in ins:
        pc = integer(item['address'])
        if current is None or pc in leaders or integer(current['instructions'][-1]['next']) != pc:
            current = {'id': item['address'], 'instructions': []}
            blocks.append(current)
        current['instructions'].append(item)
    return {'schema': SCHEMA, 'entry': func['entry'], 'name': func['name'],
            'cpu': '6809:BE:16:default', 'bank_context': func['bank_context'],
            'blocks': blocks, 'external_edges': external,
            'instruction_count': len(ins), 'truncated': bool(func.get('truncated', False))}

def normalize(raw: dict) -> dict:
    if raw.get('schema') != 'gng.ghidra-functions.v1' or raw.get('processor') != '6809:BE:16:default':
        raise ValueError('Unexpected Ghidra format/processor')
    if raw.get('bank_context') != 'bank4':
        raise ValueError('Unsupported bank context; do not flatten dynamic banks')
    results = []
    skipped = list(raw.get('skipped', []))
    for f in raw['functions']:
        try:
            if f['bank_context'] != 'bank4':
                raise ValueError('Unknown bank context')
            results.append(normalize_function(f))
        except (KeyError, ValueError, TypeError) as e:
            skipped.append({'entry': f.get('entry', '?'), 'reason': str(e)})
    if not results:
        raise ValueError('No eligible function IR. Ghidra skipped: ' + repr(skipped))
    return {'schema': 'gng.function-ir-bundle.v1', 'functions': results,
            'skipped': skipped, 'partial_discovery': bool(raw.get('partial_discovery'))}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', type=Path, required=True)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    args = ap.parse_args()
    bundle = normalize(json.loads(args.input.read_text()))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, indent=2) + '\n')
    from pcode_codegen import compile_bundle
    report = compile_bundle(bundle, args.out.parent / 'generated')
    report['discovery_skipped'] = bundle['skipped']
    report['partial_discovery'] = bundle['partial_discovery']
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(f'GNG_FUNCTION_IR=PASS functions={len(bundle["functions"])} generated={len(report["generated"])} blocked={len(report["blocked"])}')
    print(f'GNG_CODEGEN={"PASS" if report["generated"] else "BLOCKED"} generated={len(report["generated"])}')
    if report['blocked']:
        for x in report['blocked'][:12]:
            print('CODEGEN_BLOCKED', x['entry'], x['reason'])

if __name__ == '__main__':
    main()