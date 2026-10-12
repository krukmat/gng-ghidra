#!/usr/bin/env python3
"""Create synthetic P-code fixtures for CI. NOT extracted from the actual ROM."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from function_ir import normalize
from pcode_codegen import compile_bundle

def vn(space, offset, size):
    return {'space': space, 'offset': f'0x{offset:x}', 'size': size}
def op(name, out, *inputs, **extra):
    return {'op': name, 'output': out, 'inputs': list(inputs), **extra}
def ins(addr, pcode, *, raw='12', falls=None, flows=(), kind='FALL_THROUGH'):
    item = {'address': f'0x{addr:x}', 'raw': raw, 'length': len(bytes.fromhex(raw)),
            'assembly': 'synthetic-fixture', 'pcode': pcode,
            'flows': [f'0x{f:x}' for f in flows], 'flow_type': kind}
    if falls is not None: item['fallthrough'] = f'0x{falls:x}'
    return item
def func(entry, instr):
    return {'entry': f'0x{entry:x}', 'name': f'fixture_{entry:x}',
            'bank_context': 'bank4', 'instructions': instr}

# 1. RAM write through P-code address-space ID -> RAM (no custom reset signature).
write = func(0x7000, [ins(0x7000, [
    op('COPY', vn('register', 0, 2), vn('const', 0x1e00, 2)),
    op('STORE', None, vn('const', 1, 1), vn('register', 0, 2), vn('const', 0xab, 1), space_name='ram'),
    op('RETURN', None, vn('const', 0, 2))], kind='TERMINATOR')])
# 2. Mutable counter + conditional loop; execute 4 decrements and exit.
count = func(0x7010, [
    ins(0x7010, [op('COPY', vn('register', 10, 2), vn('const', 4, 2))], falls=0x7011),
    ins(0x7011, [
        op('INT_SUB', vn('register', 10, 2), vn('register', 10, 2), vn('const', 1, 2)),
        op('INT_NOTEQUAL', vn('unique', 100, 1), vn('register', 10, 2), vn('const', 0, 2)),
        op('CBRANCH', None, vn('ram', 0x7011, 2), vn('unique', 100, 1))
    ], falls=0x7012, flows=[0x7011], kind='CONDITIONAL_JUMP'),
    ins(0x7012, [op('RETURN', None, vn('const', 0, 2))], kind='TERMINATOR')])
# 3. Read big-endian word, add 1, store as word.
addition = func(0x7020, [ins(0x7020, [
    op('LOAD', vn('register', 20, 2), vn('const', 1, 1), vn('const', 0x2000, 2), space_name='ram'),
    op('INT_ADD', vn('register', 20, 2), vn('register', 20, 2), vn('const', 1, 2)),
    op('STORE', None, vn('const', 1, 1), vn('const', 0x2000, 2), vn('register', 20, 2), space_name='ram'),
    op('RETURN', None, vn('const', 0, 2))], kind='TERMINATOR')])

raw = {'schema': 'gng.ghidra-functions.v1', 'processor': '6809:BE:16:default',
       'bank_context': 'bank4', 'partial_discovery': False,
       'functions': [write, count, addition], 'skipped': []}
bundle = normalize(raw)
out = Path('out-synthetic/functions')
out.mkdir(parents=True, exist_ok=True)
(out/'fixture.raw.json').write_text(json.dumps(raw, indent=2)+'\n')
(out/'fixture.ir.json').write_text(json.dumps(bundle, indent=2)+'\n')
report = compile_bundle(bundle, out/'generated')
(out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
assert len(report['generated']) == 3 and len(report['blocked']) == 0, report
print('SYNTHETIC_FUNCTIONS=PASS count=3 (NOT real ROM functions)')