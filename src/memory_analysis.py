#!/usr/bin/env python3
"""Fail-closed abstract memory-address ranges over *one Ghidra instruction*.

An abstract interval is always an over-approximation. We never propagate
register/unique values across instructions or infer hardware state. A routine
is review-eligible only when every address is provably inside permitted ranges.
Even then, behavior/equivalence and dynamic reachability remain unverified.
"""
from __future__ import annotations

import json
from pathlib import Path
from pcode_memory_sites import sites

def _int(value):
    return int(value, 16) if isinstance(value, str) and value.lower().startswith('0x') else int(value)

def _width(node):
    try:
        size = node['size']
        return size if isinstance(size, int) and 1 <= size <= 4 else None
    except (KeyError, TypeError):
        return None

def _key(node):
    return (str(node.get('offset')), _width(node))

def _interval(node, env):
    if not isinstance(node, dict):
        return None
    size = _width(node)
    if size is None:
        return None
    space = str(node.get('space', '')).casefold()
    maxval = (1 << (size * 8)) - 1
    if space == 'const':
        try:
            v = _int(node['offset']) & maxval
            return (v, v)
        except (ValueError, TypeError, KeyError):
            return None
    if space == 'register':
        return (0, maxval)
    if space == 'unique':
        return env.get(_key(node), (0, maxval))
    return None

def _result(p, env):
    op = p.get('op')
    inputs = p.get('inputs', [])
    out = p.get('output')
    if not isinstance(out, dict) or not _width(out):
        return None
    maxval = (1 << (_width(out) * 8)) - 1
    if op in ('COPY', 'INT_ZEXT') and len(inputs) == 1:
        return _interval(inputs[0], env)
    if op == 'INT_AND' and len(inputs) == 2:
        a = _interval(inputs[0], env)
        b = _interval(inputs[1], env)
        if a is None or b is None:
            return None
        # ANY a & mask fits [0,mask], including when a comes from RAM
        # or an unconstrained register. Requiring a true constant mask
        # prevents incorrectly bounding bitwise expressions.
        for n, interval in ((inputs[0],a),(inputs[1],b)):
            if str(n.get('space','')).casefold() == 'const':
                mask = interval[0]
                if mask <= maxval:
                    return (0, mask)
        return (0,maxval)
    if op in ('INT_ADD', 'INT_SUB') and len(inputs) == 2:
        a = _interval(inputs[0], env)
        b = _interval(inputs[1], env)
        if a is None or b is None:
            return None
        low,high = ((a[0]+b[0],a[1]+b[1]) if op=='INT_ADD'
                    else (a[0]-b[1],a[1]-b[0]))
        # A 6809 integer wrap may move into I/O, so do NOT use
        # optimistic interval arithmetic across wraparound.
        return (low,high) if 0 <= low <= high <= maxval else (0,maxval)
    return None

def _decision(op, bound, size, default_ram):
    if not default_ram or size is None or not 1 <= size <= 4 or bound is None:
        return ('unresolved',False)
    lo,hi=bound
    if lo < 0 or hi + size > 65536:
        return ('unresolved',False)
    if hi+size-1 < 0x3000:
        return ('safe-ram', True)
    if op=='LOAD' and lo >= 0x4000:
        # ROM reads use the pinned bank4 snapshot, never bank switching.
        return ('safe-rom-read', True)
    if lo >= 0x3000 and hi+size-1 <= 0x3fff:
        return ('mmio',False)
    if op=='STORE' and lo >= 0x4000:
        return ('rom-write',False)
    return ('unresolved',False)

def audit_function_memory(function):
    """One record per explicit or direct RAM data access; fail closed."""
    results=[]
    for ins in function['instructions']:
        # Unique temporaries are scoped to one decoded instruction only;
        # never trust another instruction's temporaries or mutable registers.
        env={}
        for i,p in enumerate(ins.get('pcode',[])):
            op=p.get('op')
            operands=p.get('inputs',[])
            for access_op,ptr,size,form,role in sites(p):
                addr=((_int(ptr['offset']),_int(ptr['offset']))
                      if form=='direct-varnode' and isinstance(ptr,dict)
                      else _interval(ptr,env))
                default_ram=(form=='direct-varnode' or
                             (isinstance(p.get('space_name'),str) and
                              p['space_name'].casefold()=='ram'))
                result,safe=_decision(access_op,addr,size,default_ram)
                literal=(form=='direct-varnode' or
                         (isinstance(ptr,dict) and str(ptr.get('space','')).casefold()=='const'))
                results.append({
                    'instruction':ins['address'],'assembly':ins.get('assembly',''),
                    'pcode_index':i,'op':access_op,'pcode_op':op,
                    'access_form':form,'operand_role':role,
                    'space_name':p.get('space_name') if form=='explicit' else 'ram',
                    'pointer':ptr,'size':size,
                    'interval':list(addr) if addr is not None else None,
                    'derived_from': ('literal' if literal else
                        (str(ptr.get('space','')).casefold() if isinstance(ptr,dict) else 'invalid')),
                    'classification':result,'safe_for_pure_codegen':safe,
                })
            out=p.get('output')
            if isinstance(out,dict) and out.get('space','').casefold() == 'unique':
                # Any write replaces earlier knowledge: never retain a
                # previous constant when an unmodelled op overwrites it.
                derived=_result(p,env)
                env.pop(_key(out),None)
                if derived is not None and _width(out) is not None:
                    cap=(1 << (8*_width(out)))-1
                    if 0 <= derived[0] <= derived[1] <= cap:
                        env[_key(out)]=derived
    return results

def summarize_accesses(accesses):
    safe=sum(x['safe_for_pure_codegen'] for x in accesses)
    return {'total':len(accesses),'safe':safe,'unresolved_or_unsafe':len(accesses)-safe}

def report(raw):
    return {'schema':'gng.memory-audit.v1',
            'source_schema':raw.get('schema'),
            'functions':[{'entry':f['entry'],
                          'summary':summarize_accesses(audit_function_memory(f)),
                          'accesses':audit_function_memory(f)}
                         for f in raw['functions']]}

def main():
    import argparse
    from function_inventory import verify_raw
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    parser.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    parser.add_argument('--out',type=Path,default=Path('out/functions-memory-audit.json'))
    args=parser.parse_args()
    raw=json.loads(args.input.read_text())
    verify_raw(raw,args.rom_image.read_bytes())
    result=report(raw)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    print('GNG_MEMORY_AUDIT=PASS entries='+str(len(result['functions'])))
    for f in result['functions']:
        summary=f['summary']
        if summary['total']:
            print(f"  {f['entry']} accesses={summary['total']} safe={summary['safe']} "
                  f"unresolved_or_unsafe={summary['unresolved_or_unsafe']}")
            for item in f['accesses']:
                if not item['safe_for_pure_codegen']:
                    print(f"    {item['instruction']} {item['op']} "
                          f"{item['classification']} ptr={item['pointer']}"
                          f" range={item['interval']}")

if __name__=='__main__':
    main()
