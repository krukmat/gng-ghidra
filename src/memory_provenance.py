#!/usr/bin/env python3
"""ROM-backed Ghidra P-code memory pointer provenance, not a safety proof.

Trace one instruction's temporary dependencies to MC6809 registers.
Do not infer values between instructions, runtime call reachability, or
stack bounds. Purely diagnostic: existing MMIO/ROM write gates remain intact.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from memory_analysis import audit_function_memory
from function_inventory import verify_raw
from pcode_memory_sites import sites

# Ghidra 6x09.sinc register offsets in byte-addressed register space.
# For ordinary 6809 (not the HD6309 optional register extension):
CPU_REGISTERS = {
    (0, 1): 'A', (1, 1): 'B', (0, 2): 'D',
    (8, 1): 'CC', (9, 1): 'DP',
    (16, 2): 'PC', (18, 2): 'X', (20, 2): 'Y',
    (22, 2): 'U', (24, 2): 'S',
}

def _offset(node):
    value = node.get('offset')
    return int(value, 16) if isinstance(value, str) and value.lower().startswith('0x') else int(value)

def _unique_key(node):
    return (_offset(node), node['size'])

def _sources(node, unique):
    if not isinstance(node, dict):
        return frozenset({'invalid-pointer'})
    space = str(node.get('space', '')).casefold()
    if space == 'const':
        return frozenset({'literal'})
    if space == 'register':
        try:
            return frozenset({CPU_REGISTERS.get((_offset(node),node['size']),
                              'reg@' + str(node.get('offset')) + ':' + str(node.get('size')))})
        except (TypeError, ValueError, KeyError):
            return frozenset({'invalid-register'})
    if space == 'unique':
        try:
            return unique.get(_unique_key(node), frozenset({'unresolved-unique'}))
        except (TypeError, ValueError, KeyError):
            return frozenset({'invalid-unique'})
    return frozenset({'unknown-' + space})

def _lineage(inputs, unique):
    origins=set()
    for op in inputs:
        origins.update(_sources(op, unique))
    # Constants only change the value, not the register dependencies.
    if 'literal' in origins and len(origins)>1:
        origins.discard('literal')
    return frozenset(origins or {'no-source'})

def _bucket(sources):
    if sources == frozenset({'S'}):
        return 'stack-S'
    if sources == frozenset({'X'}):
        return 'index-X'
    if sources == frozenset({'Y'}):
        return 'index-Y'
    if sources == frozenset({'U'}):
        return 'index-U'
    if sources == frozenset({'DP'}):
        return 'direct-page-DP'
    if sources == frozenset({'literal'}):
        return 'literal'
    if len(sources) == 1:
        name=next(iter(sources))
        return 'other-' + name
    return 'mixed-' + ','.join(sorted(sources))

def profile(function):
    audited = audit_function_memory(function)
    by_site={(x['instruction'], x['pcode_index'], x['access_form'], x['operand_role']):x
             for x in audited}
    items=[]
    for ins in function['instructions']:
        # Unique offsets can be reused by unrelated instructions. Reset here.
        unique={}
        for index,op in enumerate(ins.get('pcode', [])):
            name=op.get('op')
            inputs=op.get('inputs', [])
            for access_op,ptr,size,form,role in sites(op):
                source=(frozenset({'literal'}) if form=='direct-varnode'
                        else _sources(ptr,unique))
                observed=by_site.get((ins['address'],index,form,role))
                if observed is None:
                    raise ValueError('Audit/trace memory-operation mismatch')
                items.append({
                    'address':ins['address'],
                    'assembly':ins.get('assembly',''),
                    'pcode_index':index,'access_form':form,'operand_role':role,
                    'operation':access_op,
                    'bucket':_bucket(source),
                    'sources':sorted(source),
                    'pointer':ptr,
                    'range':observed['interval'],
                    'classification':observed['classification'],
                    'safe':observed['safe_for_pure_codegen'],
                })
            out=op.get('output')
            if isinstance(out,dict) and str(out.get('space','')).casefold()=='unique':
                key=_unique_key(out)
                # LOAD produces an arbitrary memory value, not a pointer
                # whose range can be inferred from its source address.
                if name=='LOAD':
                    unique[key]=frozenset({'memory-value'})
                else:
                    unique[key]=_lineage(inputs,unique)
    return items

def summarize(raw, entries=None, sample_count=2):
    all_entries={x['entry']:x for x in raw['functions']}
    if entries:
        missing=set(entries)-set(all_entries)
        if missing:
            raise ValueError('Unknown function entries: '+', '.join(sorted(missing)))
        functions=[all_entries[k] for k in entries]
    else:
        functions=raw['functions']
    result=[]
    for f in functions:
        accesses=profile(f)
        buckets=Counter(a['bucket'] for a in accesses)
        samples=defaultdict(list)
        for a in accesses:
            if not a['safe'] and len(samples[a['bucket']])<sample_count:
                samples[a['bucket']].append({
                    'address':a['address'],
                    'assembly':a['assembly'],
                    'op':a['operation'],
                    'pointer':a['pointer'],
                    'sources':a['sources'],
                })
        result.append({
            'entry':f['entry'],'count':len(accesses),
            'safe':sum(x['safe'] for x in accesses),
            'buckets':dict(sorted(buckets.items())),
            'examples':dict(sorted(samples.items())),
        })
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    parser.add_argument('--entries',nargs='*',default=None)
    parser.add_argument('--samples',type=int,default=1)
    parser.add_argument('--out',type=Path,default=Path('out/functions-memory-provenance.json'))
    args=parser.parse_args()
    if not 0<=args.samples<=5:
        parser.error('--samples must be 0..5')
    raw=json.loads(args.input.read_text())
    verify_raw(raw,args.rom_image.read_bytes())
    result=summarize(raw,args.entries,args.samples)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps({
        'schema':'gng.memory-provenance.v1',
        'safety_note':'Diagnostic only. Pointer provenance is NOT a memory-bound proof.',
        'functions':result,
    },indent=2,sort_keys=True)+'\n')
    print('GNG_MEMORY_PROVENANCE=PASS functions='+str(len(result))+
          ' accesses='+str(sum(x['count'] for x in result))+
          ' safe='+str(sum(x['safe'] for x in result)))
    for f in result:
        print('  '+f['entry']+' access='+str(f['count'])+' safe='+str(f['safe'])+
              ' origins='+','.join(k+':'+str(v) for k,v in f['buckets'].items()))
        for bucket, samples in f['examples'].items():
            for example in samples:
                print('    '+bucket+' '+example['address']+' '+
                      example['op']+' '+example['assembly'])
    print('GNG_MEMORY_PROVENANCE=UNVERIFIED_BOUNDS '
          'S/X/Y/U are origin labels only; no safety gate changed')

if __name__=='__main__':
    main()
