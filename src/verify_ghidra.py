#!/usr/bin/env python3
"""Cross-check Ghidra instruction boundaries/bytes against our bounded lifter."""
import argparse
import json
from pathlib import Path

def verify(lir, pcode):
    if pcode.get('schema') != 'gng.ghidra-pcode.v1':
        raise ValueError('Unexpected Ghidra schema')
    if pcode.get('processor') != '6809:BE:16:default':
        raise ValueError('Wrong processor')
    expected = lir['instructions']
    received = pcode['instructions']
    if len(expected) != len(received):
        raise ValueError(f'Instruction count mismatch: {len(expected)} vs {len(received)}')
    for item, g in zip(expected, received):
        if item['address'] != g['address'] or item['raw'] != g['raw']:
            raise ValueError(f"Ghidra/LIR instruction mismatch at {item['address']}")
        if not g.get('pcode'):
            raise ValueError(f"Missing P-code at {item['address']}")
    return len(expected)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lir', type=Path, required=True)
    parser.add_argument('--pcode', type=Path, required=True)
    args = parser.parse_args()
    count = verify(json.loads(args.lir.read_text()), json.loads(args.pcode.read_text()))
    print(f'GHIDRA_PCODE_CROSSCHECK=PASS instruction_count={count}')
