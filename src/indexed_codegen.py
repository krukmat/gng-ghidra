#!/usr/bin/env python3
"""Third real-ROM candidate: fail-closed indexed-RAM experimental codegen.

0x6239 has 10/12 conditionally bounded P-code memory operations and
two X/Y/U-index-dependent unresolved sites in the operator's ROM audit.
No MMIO is authorized. The actual index register(s) are discovered
from byte-attested Ghidra P-code; never guessed or silently allowed.
This is *not* a proof of game entry-state reachability or native CPU
equivalence.
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
from guarded_codegen import guard_source, CONTRACT_NAME
from pcode_codegen import compile_function, Unsupported
from third_routine_candidates import rank

ENTRY = '0x6239'
INDEX_OFFSETS = {'X': 18, 'Y': 20, 'U': 22}
# Conservative laboratory contract. Effective addresses remain separately
# checked by the existing memRead/memWrite 0x3000 MMIO boundary.
INDEX_LOW = 0x0100
INDEX_HIGH = 0x2ffc
SCHEMA = 'gng.indexed-pcode-experiment.v1'


def validate(raw: dict, image: bytes) -> dict:
    verify_raw(raw, image)
    listing = rank(raw, image)
    found = next((x for x in listing['candidates']
                  if x['entry'] == ENTRY), None)
    if found is None:
        raise Unsupported('0x6239 absent from byte-attested Ghidra export')
    if (found['status'] != 'NEEDS_REGISTER_BOUNDS' or
            not found['modeled_6809_rts_stack_pop'] or
            found['overlapping_exported_instruction_count'] or
            not found['structural_compile_possible'] or
            found['mmio_access_count'] or found['rom_write_count']):
        raise Unsupported('0x6239 structural candidate changed or unsafe: ' +
                          str(found['blockers']))
    fun = next(x for x in raw['functions'] if x['entry'] == ENTRY)
    bounded = evaluate(fun)
    accesses = bounded['accesses']
    origins = profile(fun)
    if len(accesses) != 12 or bounded['conditionally_in_range'] != 10 or \
            len(origins) != len(accesses):
        raise Unsupported('Changed P-code memory obligations for 0x6239: ' +
                          str(bounded['conditionally_in_range']) + '/' +
                          str(len(accesses)))
    indexed=[]
    for site,origin in zip(accesses, origins):
        classification=site['hypothetical_classification']
        if site['proof_requires_enforcement']:
            if classification not in ('ram-under-hypothesis',
                                      'rom-read-under-hypothesis'):
                raise Unsupported('Unsafe supposedly bounded site')
            continue
        if classification != 'unresolved':
            raise Unsupported('MMIO or forbidden pointer site at ' +
                              site['instruction'] + ': ' + classification)
        sources=origin['sources']
        if len(sources) != 1 or sources[0] not in INDEX_OFFSETS:
            raise Unsupported('Unbounded pointer not exclusively X/Y/U: ' +
                              str({'address':origin['address'],
                                   'sources':sources,'bucket':origin['bucket']}))
        indexed.append({'pc':site['instruction'],
                        'register':sources[0],
                        'op':site['operation'],
                        'width':site['width_bytes'],
                        'pointer':site['pointer']})
    if len(indexed)!=2:
        raise Unsupported('Expected exactly two index-only pointer sites, got ' +
                          str(len(indexed)))
    used=sorted({x['register'] for x in indexed})
    returns=[i for i in fun['instructions']
             if i['raw'].casefold()=='39' and
             any(p['op']=='RETURN' for p in i['pcode'])]
    if len(returns)!=1:
        raise Unsupported('Expected unique ROM-authenticated RTS instruction')
    return {'function':fun, 'indexed':indexed,
            'registers':used,'return_instruction':returns[0]['address'],
            'memory_total':len(accesses),
            'conditionally_bounded':bounded['conditionally_in_range']}


def instrument(guarded_js: str, register_names: list[str]) -> str:
    if not register_names or set(register_names)-INDEX_OFFSETS.keys():
        raise Unsupported('Unsupported index register contract')
    declaration='  const tmp=new Map();'
    if guarded_js.count(declaration)!=1:
        raise Unsupported('Indexed guard insertion anchor missing or ambiguous')
    conditions=[]
    for reg in register_names:
        offset=INDEX_OFFSETS[reg]
        conditions.append(f'    const {reg}=(registers[{offset}]*256)+registers[{offset+1}];')
        conditions.append(
            f'    if ({reg} < {INDEX_LOW} || {reg} > {INDEX_HIGH}) ' +
            f"throw new RangeError('Unmet experimental index {reg} contract');")
    addition=('  function assertIndex() {\n'+
              '\n'.join(conditions)+'\n  }\n')
    result=guarded_js.replace(declaration,addition+declaration,1)
    entry='  assertDpS();\n'
    memory='    assertDpS();\n'
    # Exactly one entry guard plus read and write helpers.
    if result.count(entry)!=1 or result.count(memory)!=2:
        raise Unsupported('Missing/ambiguous DP/S runtime guard locations')
    result=result.replace(entry,'  assertDpS(); assertIndex();\n',1)
    result=result.replace(memory,'    assertDpS(); assertIndex();\n')
    return ('// CONDITIONAL INDEXED RAM EXPERIMENT; NO 6809 EQUIVALENCE\n'+
            result)


def build(raw: dict, image: bytes, output_dir: Path) -> dict:
    report={'schema':SCHEMA, 'status':'BLOCKED',
            'contract': CONTRACT_NAME+'; index '+hex(INDEX_LOW)+'..'+hex(INDEX_HIGH),
            'rom_sha256':hashlib.sha256(image).hexdigest(),
            'native_equivalence_verified':False,
            'actual_game_entry_conditions_proven':False,
            'pure_unconditional_codegen_eligibility_changed':False,
            'generated':[],'blocked':[]}
    try:
        verified=validate(raw,image)
        js=instrument(guard_source(compile_function(
            normalize_function(verified['function']))),
            verified['registers'])
        output_dir.mkdir(parents=True,exist_ok=True)
        path=output_dir/'indexed_6239.mjs'
        path.write_text(js)
        report['generated'].append({
            'entry':ENTRY,'javascript':str(path),
            'sha256':hashlib.sha256(js.encode()).hexdigest(),
            'indexed_memory_sites':verified['indexed'],
            'index_registers':verified['registers'],
            'source_rts':verified['return_instruction'],
            'memory_sites':verified['memory_total'],
            'conditionally_bounded':verified['conditionally_bounded'],
            'runtime_per_memory_access_guards':True,
            'input_state_copied':True,
            'native_equivalence_verified':False,
        })
        report['status']='EXPERIMENTAL_INDEXED_JS_NOT_NATIVE_EQUIVALENCE'
    except (Unsupported,ValueError,KeyError,TypeError,IndexError) as exc:
        report['blocked'].append({'entry':ENTRY,'reason':str(exc)})
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    parser.add_argument('--out',type=Path,default=Path('out/generated-indexed'))
    args=parser.parse_args()
    raw=json.loads(args.input.read_text())
    image=args.rom_image.read_bytes()
    report=build(raw,image,args.out)
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'report.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print('GNG_INDEXED_CODEGEN='+('EXPERIMENTAL' if report['generated'] else 'BLOCKED')+
          ' generated='+str(len(report['generated']))+
          ' blocked='+str(len(report['blocked'])))
    for item in report['generated']:
        print('  '+item['entry']+' indexes='+','.join(item['index_registers'])+
              ' source_rts='+item['source_rts']+' native=UNVERIFIED')
    for item in report['blocked']:
        print('  '+item['entry']+' BLOCKED '+item['reason'])
    print('GNG_THIRD_ROUTINE=UNVERIFIED_NATIVE_EQUIVALENCE index bounds synthetic')


if __name__=='__main__':
    main()
