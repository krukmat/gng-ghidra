#!/usr/bin/env python3
"""Generate *experimental* guarded P-code JS for two ROM leaf candidates.

This uses byte-verified Ghidra export and the existing fail-closed P-code
compiler. Entry DP/S preconditions are NOT assumed to hold in the game.
Guards are checked at entry and before every emitted memory access.
Inputs are cloned: a rejected execution cannot mutate caller buffers.

Success proves only that conditional execution of compiled P-code can
complete; NO 6809-reference equivalence, reachability or bank behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from function_inventory import verify_raw
from function_ir import normalize_function
from memory_contracts import evaluate
from pcode_codegen import compile_function, Unsupported

EXPECTED = {'0x622c': 3, '0x6755': 5}
CONTRACT_NAME = 'illustrative-dp00-s0100-2ffc'
CORE_SIGNATURE = 'export function runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000) {'
DECLARATION = '  const tmp=new Map();'
READ_HEADER = '  function memRead(addr,size) {\n'
WRITE_HEADER = '  function memWrite(addr,size,v) {\n'

GUARD = """  // This is an enforced *test precondition*, not a proven ROM invariant.
  function assertDpS() {
    const stack=(registers[24]*256)+registers[25];
    if (registers[9] !== 0 || stack < 0x0100 || stack > 0x2ffc)
      throw new RangeError('Unmet experimental DP/S contract');
  }
  assertDpS();
"""

WRAPPER = """
// Inputs are not mutated even when the original P-code compiler throws.
export function runRoutine(memory, registers=new Uint8Array(256), maxSteps=10000) {
  if (!(memory instanceof Uint8Array) || memory.length !== 65536)
    throw new RangeError('64 KiB memory required');
  if (!(registers instanceof Uint8Array) || registers.length !== 256)
    throw new RangeError('256-byte register file required');
  if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0)
    throw new RangeError('positive step budget required');
  return runRoutineCore(memory.slice(),registers.slice(),maxSteps);
}
"""

def _once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise Unsupported('Guard insertion anchor missing/ambiguous; refusing unguarded artifact')
    return source.replace(old, new, 1)

def guard_source(js: str) -> str:
    """Add fail-closed DP/S runtime checks to precompiled JS, not P-code IR."""
    js = _once(js, CORE_SIGNATURE,
               'function runRoutineCore(memory, registers=new Uint8Array(256), maxSteps=10000) {')
    js = _once(js, DECLARATION, GUARD + DECLARATION)
    js = _once(js, READ_HEADER, READ_HEADER + '    assertDpS();\n')
    js = _once(js, WRITE_HEADER, WRITE_HEADER + '    assertDpS();\n')
    return '// CONDITIONAL EXPERIMENT ONLY; NOT FUNCTIONAL EQUIVALENCE\n' + js + WRAPPER

def build(raw: dict, image: bytes, output_dir: Path, entries=None) -> dict:
    verify_raw(raw, image)
    requested = entries if entries is not None else list(EXPECTED)
    if not requested or len(set(requested)) != len(requested):
        raise ValueError('Require one or more nonduplicate entries')
    if set(requested) - set(EXPECTED):
        raise ValueError('Only approved 0x622c/0x6755 candidates allowed')
    funcs = {f['entry']: f for f in raw['functions']}
    report = {'schema':'gng.guarded-pcode-experiment.v1',
              'contract':CONTRACT_NAME,
              'status':'EXPERIMENTAL_NOT_EQUIVALENCE_VERIFIED',
              'unconditional_codegen_eligibility_changed':False,
              'generated':[], 'blocked':[]}
    for entry in requested:
        func = funcs.get(entry)
        if func is None:
            report['blocked'].append({'entry':entry,'reason':'Not exported by Ghidra'})
            continue
        obligations = evaluate(func)
        if (obligations['access_count'] != EXPECTED[entry] or
                obligations['conditionally_in_range'] != EXPECTED[entry] or
                obligations['unresolved_or_forbidden'] != 0):
            report['blocked'].append({'entry':entry,'reason':'DP/S contract obligations not all bounded'})
            continue
        try:
            normal = compile_function(normalize_function(func))
            js = guard_source(normal)
        except (Unsupported, ValueError, KeyError, TypeError) as ex:
            report['blocked'].append({'entry':entry,'reason':str(ex)})
            continue
        output_dir.mkdir(parents=True,exist_ok=True)
        dest = output_dir / ('guarded_' + entry[2:] + '.mjs')
        dest.write_text(js)
        report['generated'].append({
            'sha256': hashlib.sha256(js.encode('utf-8')).hexdigest(),
            'entry':entry,'javascript':str(dest),
            'conditional_access_count':EXPECTED[entry],
            'entry_and_per_memory_access_guards':True,
            'input_state_copied':True,
            'equivalence_verified':False,
        })
    return report

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    ap.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    ap.add_argument('--out',type=Path,default=Path('out/generated-guarded'))
    ap.add_argument('--entries',nargs='*',default=['0x622c','0x6755'])
    args=ap.parse_args()
    result = build(json.loads(args.input.read_text()), args.rom_image.read_bytes(),
                   args.out, args.entries)
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'report.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    print('GNG_GUARDED_CODEGEN=EXPERIMENTAL generated='+str(len(result['generated']))+
          ' blocked='+str(len(result['blocked'])))
    for f in result['generated']:
        print('  '+f['entry']+' guarded='+f['javascript']+' equivalence=UNVERIFIED')
    for f in result['blocked']:
        print('  '+f['entry']+' BLOCKED '+f['reason'])
    print('GNG_T2B_ACCEPTANCE=NOT_ESTABLISHED controlled inputs != native 6809 reference')

if __name__=='__main__':
    main()
