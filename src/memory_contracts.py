#!/usr/bin/env python3
"""Conditional MC6809 DP/S memory proof obligations; NOT codegen eligibility.

DP==0 and 0x0100<=S<=0x2ffc are illustrative conditions at EVERY
instruction. There is no evidence they hold during actual game execution.
No runtime guards, memory permissions, or compiler decisions are changed.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from pcode_memory_sites import sites

HYPOTHESIS = {
    'name': 'illustrative-dp00-s0100-2ffc',
    'register_ranges': {'9:1': [0,0], '24:2': [0x100,0x2ffc]},
    'enforcement': 'UNPROVEN: conditions needed at every instruction',
}

def _number(v):
    return int(v,16) if isinstance(v,str) and v.lower().startswith('0x') else int(v)

def _width(v):
    if not isinstance(v,dict) or type(v.get('size')) is not int:
        return None
    return v['size'] if 1<=v['size']<=4 else None

def _identity(v):
    if not isinstance(v,dict):
        return None
    try:
        return (str(v.get('space','')).casefold(),_number(v['offset']),v['size'])
    except (KeyError,TypeError,ValueError):
        return None

def _top(v):
    size=_width(v)
    return (0,(1<<(8*size))-1) if size else None

def _read(v,env,bounds):
    key=_identity(v)
    if key is None:
        return None
    space,offset,width=key
    if key in env:
        return env[key]
    if space=='const':
        x=offset&((1<<(8*width))-1)
        return (x,x)
    if space=='register':
        return bounds.get(f'{offset}:{width}',_top(v))
    if space=='unique':
        return _top(v)
    return None

def _calc(op,inputs,out,env,bounds):
    width=_width(out)
    if not width:
        return None
    maximum=(1<<(8*width))-1
    a=_read(inputs[0],env,bounds) if inputs else None
    if op in ('COPY','INT_ZEXT') and len(inputs)==1 and a:
        r=a
    elif op=='INT_LEFT' and len(inputs)==2 and a:
        b=_read(inputs[1],env,bounds)
        if b is None or b[0]!=b[1] or not 0<=b[0]<=31:
            return None
        r=(a[0]<<b[0],a[1]<<b[0])
    elif op in ('INT_ADD','INT_SUB') and len(inputs)==2 and a:
        b=_read(inputs[1],env,bounds)
        if b is None:
            return None
        r=((a[0]+b[0],a[1]+b[1]) if op=='INT_ADD'
           else (a[0]-b[1],a[1]-b[0]))
    elif op=='INT_AND' and len(inputs)==2:
        literal=next((x for x in inputs if isinstance(x,dict) and
                      str(x.get('space','')).casefold()=='const'),None)
        mask=_read(literal,env,bounds)
        if mask is None:
            return None
        r=(0,mask[1]&maximum)
    elif op=='PIECE' and len(inputs)==2 and a:
        b=_read(inputs[1],env,bounds)
        w=_width(inputs[1])
        if b is None or w is None:
            return None
        r=(a[0]*(1<<(8*w))+b[0],a[1]*(1<<(8*w))+b[1])
    else:
        return None
    # Overflow and unknown arithmetic are full-width unknown, never clipped.
    return r if 0<=r[0]<=r[1]<=maximum else None

def _classify(op,interval,size,space):
    if space!='ram' or interval is None or type(size) is not int or not 1<=size<=4:
        return 'unresolved'
    lo,hi=interval
    if lo<0 or hi+size>65536:
        return 'unresolved'
    if hi+size<=0x3000:
        return 'ram-under-hypothesis'
    if op=='LOAD' and lo>=0x4000:
        return 'rom-read-under-hypothesis'
    if op=='STORE' and lo>=0x4000:
        return 'rom-write-forbidden'
    if lo>=0x3000 and hi+size<=0x4000:
        return 'mmio-forbidden'
    return 'unresolved'

def evaluate(function,hypothesis=HYPOTHESIS):
    """Hypothetical per-instruction proof; cross-instruction invariants unproven."""
    bounds=hypothesis['register_ranges']
    rows=[]
    for ins in function['instructions']:
        env={} # never propagate unique or register facts across instructions
        for i,p in enumerate(ins.get('pcode',[])):
            op=p.get('op')
            inputs=p.get('inputs',[])
            for access_op,ptr,size,form,role in sites(p):
                if form=='direct-varnode' and isinstance(ptr,dict):
                    addr=_number(ptr['offset'])
                    interval=(addr,addr)
                else:
                    interval=_read(ptr,env,bounds)
                space=('ram' if form=='direct-varnode'
                       else str(p.get('space_name','')).casefold())
                status=_classify(access_op,interval,size,space)
                rows.append({
                    'instruction':ins['address'], 'assembly':ins.get('assembly',''),
                    'pcode_index':i, 'operation':access_op,'pcode_op':op,
                    'access_form':form,'operand_role':role,'pointer':ptr,
                    'address_interval':list(interval) if interval else None,
                    'width_bytes':size, 'hypothetical_classification':status,
                    'proof_requires_enforcement':status in
                        ('ram-under-hypothesis','rom-read-under-hypothesis'),
                })
            out=p.get('output')
            key=_identity(out)
            if key is not None and key[0] in ('unique','register'):
                new=_calc(op,inputs,out,env,bounds)
                if key[0]=='register':
                    # A write to any overlapping byte invalidates assumed DP/S
                    # even when it is an alias with a different varnode size.
                    start,stop=key[1],key[1]+key[2]
                    for rule in ('9:1','24:2'):
                        off,width=map(int,rule.split(':'))
                        if start<off+width and stop>off:
                            env[('register',off,width)]=(0,(1<<(8*width))-1)
                env[key]=new if new is not None else _top(out)
    count=sum(x['proof_requires_enforcement'] for x in rows)
    return {
        'entry':function['entry'],'access_count':len(rows),
        'conditionally_in_range':count,
        'unresolved_or_forbidden':len(rows)-count,
        'entry_invariant_proven':False, 'conditional_only':True,'accesses':rows,
    }

def report(raw,entries=None):
    functions={f['entry']:f for f in raw['functions']}
    if entries:
        unknown=set(entries)-set(functions)
        if unknown:
            raise ValueError('Unknown entries: '+', '.join(sorted(unknown)))
        chosen=[functions[k] for k in entries]
    else:
        chosen=raw['functions']
    return {
        'schema':'gng.memory-conditional-obligations.v1',
        'hypothesis':HYPOTHESIS,
        'status':'UNVERIFIED_ENTRY_INVARIANTS',
        'compiler_eligibility_changed':False,
        'functions':[evaluate(f) for f in chosen],
    }

def main():
    from function_inventory import verify_raw
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input',type=Path,default=Path('out/functions.raw.json'))
    ap.add_argument('--rom-image',type=Path,default=Path('out/gngb-flat.bin'))
    ap.add_argument('--out',type=Path,default=Path('out/functions-memory-obligations.json'))
    ap.add_argument('--entries',nargs='*',default=['0x622c','0x6755'])
    args=ap.parse_args()
    raw=json.loads(args.input.read_text())
    verify_raw(raw,args.rom_image.read_bytes())
    result=report(raw,args.entries)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    print('GNG_CONDITIONAL_MEMORY=UNVERIFIED_ENTRY_INVARIANTS functions='+str(len(result['functions'])))
    for f in result['functions']:
        print(f"  {f['entry']} hypothetical_in_range={f['conditionally_in_range']}/{f['access_count']} "
              f"still_unresolved_or_forbidden={f['unresolved_or_forbidden']}")
        for a in f['accesses']:
            if not a['proof_requires_enforcement']:
                print('    '+a['instruction']+' '+a['assembly']+': '+a['hypothetical_classification'])
    print('GNG_CODEGEN_ELIGIBILITY=UNCHANGED DP/S contract unproven; no behavioral equivalence')

if __name__=='__main__':
    main()
